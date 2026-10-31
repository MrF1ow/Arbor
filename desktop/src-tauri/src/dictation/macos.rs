use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::{AnyThread, ClassType, MainThreadMarker};
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
use objc2_avf_audio::{AVAudioEngine, AVAudioFormat, AVAudioNode, AVAudioPCMBuffer, AVAudioTime};
use objc2_foundation::{NSError, NSOperationQueue};
use objc2_speech::{
    SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognitionTask,
    SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
};
use tauri::ipc::Channel;
use tauri::AppHandle;

use super::{
    apply_recognizer_result, channel_is_audible, emit_dictation_event, error_event, failed_message,
    finish_event, microphone_denied_message, speech_denied_message, speech_task_terminal,
    unavailable_message, DictationEvent, DICTATION_AUTO_STOP_SECS, FINAL_TIMEOUT_SECS,
};

struct LiveObjects {
    // The task stops delivering results if its recognizer is released, so keep it alive.
    _recognizer: Retained<SFSpeechRecognizer>,
    engine: Retained<AVAudioEngine>,
    request: Retained<SFSpeechAudioBufferRecognitionRequest>,
    task: Retained<SFSpeechRecognitionTask>,
    _tap_block:
        RcBlock<dyn Fn(core::ptr::NonNull<AVAudioPCMBuffer>, core::ptr::NonNull<AVAudioTime>)>,
    _result_handler: RcBlock<dyn Fn(*mut SFSpeechRecognitionResult, *mut NSError)>,
}

struct SessionControl {
    id: u64,
    cancelled: AtomicBool,
    terminal_sent: AtomicBool,
    released: AtomicBool,
    stopping: AtomicBool,
    audio_buffers: AtomicU64,
    last_partial: Mutex<String>,
    channel: Channel<DictationEvent>,
}

thread_local! {
    static LIVE: RefCell<Option<LiveObjects>> = const { RefCell::new(None) };
    static CONTROL: RefCell<Option<Arc<SessionControl>>> = const { RefCell::new(None) };
}

fn control_is_current(control: &SessionControl) -> bool {
    CONTROL.with(|cell| cell.borrow().as_ref().is_some_and(|c| c.id == control.id))
}

/// The session can still emit its terminal event (stopping is fine: that is how a stop finishes).
fn can_finish(control: &SessionControl) -> bool {
    control_is_current(control)
        && !control.cancelled.load(Ordering::SeqCst)
        && !control.terminal_sent.load(Ordering::SeqCst)
}

/// Not yet listening and should not start (cancelled, stopped, or already finished).
fn session_aborted(control: &SessionControl) -> bool {
    control.cancelled.load(Ordering::SeqCst)
        || control.stopping.load(Ordering::SeqCst)
        || control.terminal_sent.load(Ordering::SeqCst)
}

fn release(control: &SessionControl) {
    if control.released.swap(true, Ordering::SeqCst) {
        return;
    }
    let live = LIVE.with(|cell| cell.borrow_mut().take());
    if let Some(live) = live {
        let input = unsafe { live.engine.inputNode() };
        let node = input.as_super().as_super();
        unsafe { node.removeTapOnBus(0) };
        unsafe { live.engine.stop() };
        unsafe { live.task.cancel() };
    }
    CONTROL.with(|cell| {
        if cell.borrow().as_ref().is_some_and(|c| c.id == control.id) {
            *cell.borrow_mut() = None;
        }
    });
}

fn format_is_usable(format: &AVAudioFormat) -> bool {
    unsafe { format.sampleRate() > 0.0 && format.channelCount() > 0 }
}

/// The hardware input format. The input node cannot convert, so the tap and the
/// mixer connection both have to use it. The output format is often 0 Hz until
/// that connection exists.
fn microphone_format(node: &AVAudioNode) -> Result<Retained<AVAudioFormat>, String> {
    let input = unsafe { node.inputFormatForBus(0) };
    if format_is_usable(&input) {
        return Ok(input);
    }
    let output = unsafe { node.outputFormatForBus(0) };
    if format_is_usable(&output) {
        return Ok(output);
    }
    Err("The microphone isn't ready. Check the input device in System Settings › Sound.".into())
}

fn buffer_is_audible(buffer: &AVAudioPCMBuffer) -> bool {
    let frames = unsafe { buffer.frameLength() } as usize;
    if frames == 0 {
        return false;
    }
    let channels = unsafe { buffer.floatChannelData() };
    if channels.is_null() {
        // Not float PCM. A delivered buffer still counts as audio.
        return true;
    }
    let samples = unsafe { std::slice::from_raw_parts((*channels).as_ptr(), frames) };
    channel_is_audible(samples)
}

/// Speech calls the result handler on its queue. Session thread-locals live on
/// the main thread, so every event is delivered there before it is applied.
fn deliver_on_main(app: &AppHandle, control: Arc<SessionControl>, event: DictationEvent) {
    let app = app.clone();
    let _ = app.run_on_main_thread(move || {
        if control.cancelled.load(Ordering::SeqCst) || !control_is_current(&control) {
            return;
        }
        match event {
            DictationEvent::Partial { text } => {
                if control.terminal_sent.load(Ordering::SeqCst) {
                    return;
                }
                emit_dictation_event(&control.channel, DictationEvent::Partial { text });
            }
            other => {
                if !can_finish(&control) {
                    return;
                }
                emit_terminal_on_main(&control, other);
            }
        }
    });
}

fn emit_terminal_on_main(control: &SessionControl, event: DictationEvent) {
    if control.cancelled.load(Ordering::SeqCst) {
        release(control);
        return;
    }
    if control.terminal_sent.swap(true, Ordering::SeqCst) {
        return;
    }
    let buffers = control.audio_buffers.load(Ordering::SeqCst);
    emit_dictation_event(&control.channel, finish_event(event, buffers));
    release(control);
}

fn schedule_final_timeout(app: AppHandle, control: Arc<SessionControl>) {
    let session_id = control.id;
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(FINAL_TIMEOUT_SECS));
        let control_main = control.clone();
        let _ = app.run_on_main_thread(move || {
            if control_main.id != session_id || !can_finish(&control_main) {
                return;
            }
            let text = control_main
                .last_partial
                .lock()
                .map(|v| v.clone())
                .unwrap_or_default();
            emit_terminal_on_main(&control_main, DictationEvent::Final { text });
        });
    });
}

fn begin_listening(app: AppHandle, control: Arc<SessionControl>) {
    if !control_is_current(&control) || session_aborted(&control) {
        return;
    }
    let Some(mtm) = MainThreadMarker::new() else {
        emit_terminal_on_main(&control, error_event("failed", failed_message(None)));
        return;
    };
    let _ = mtm;

    let alloc = SFSpeechRecognizer::alloc();
    let Some(recognizer) = (unsafe { SFSpeechRecognizer::init(alloc) }) else {
        emit_terminal_on_main(&control, error_event("unavailable", unavailable_message()));
        return;
    };
    if !unsafe { recognizer.isAvailable() } {
        emit_terminal_on_main(&control, error_event("unavailable", unavailable_message()));
        return;
    }
    // Keep callbacks on the main thread, where the session thread-locals live.
    unsafe { recognizer.setQueue(&NSOperationQueue::mainQueue()) };

    if session_aborted(&control) {
        return;
    }

    let request = unsafe { SFSpeechAudioBufferRecognitionRequest::new() };
    let request_super = request.as_super();
    unsafe {
        request_super.setShouldReportPartialResults(true);
        // Punctuation stays off. On macOS it combines with on-device recognition
        // and the transcript comes back empty.
    }

    let engine = unsafe { AVAudioEngine::new() };
    let input = unsafe { engine.inputNode() };
    let node = input.as_super().as_super();
    // A tap on an unconnected input node records silence on macOS. Connect it
    // to the mixer, muted, so the hardware format is real and nothing plays back.
    let format = match microphone_format(node) {
        Ok(format) => format,
        Err(message) => {
            emit_terminal_on_main(&control, error_event("failed", message));
            return;
        }
    };
    let mixer = unsafe { engine.mainMixerNode() };
    unsafe {
        engine.connect_to_format(node, mixer.as_super(), Some(&format));
        mixer.setOutputVolume(0.0);
    }

    let request_for_tap = request.clone();
    let control_for_tap = control.clone();
    let tap_block = RcBlock::new(
        move |buffer: core::ptr::NonNull<AVAudioPCMBuffer>,
              _when: core::ptr::NonNull<AVAudioTime>| {
            let pcm = unsafe { buffer.as_ref() };
            if buffer_is_audible(pcm) {
                control_for_tap.audio_buffers.fetch_add(1, Ordering::SeqCst);
            }
            unsafe {
                request_for_tap.appendAudioPCMBuffer(pcm);
            }
        },
    );
    unsafe {
        node.installTapOnBus_bufferSize_format_block(
            0,
            4096,
            Some(&format),
            RcBlock::as_ptr(&tap_block),
        );
    }

    unsafe { engine.prepare() };
    if let Err(err) = unsafe { engine.startAndReturnError() } {
        unsafe { node.removeTapOnBus(0) };
        let detail = err.localizedDescription().to_string();
        emit_terminal_on_main(
            &control,
            error_event("failed", failed_message(Some(&detail))),
        );
        return;
    }

    if session_aborted(&control) {
        unsafe { node.removeTapOnBus(0) };
        unsafe { engine.stop() };
        return;
    }

    let app_for_handler = app.clone();
    let control_for_handler = control.clone();
    let result_handler = RcBlock::new(
        move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
            let control = control_for_handler.clone();
            if control.cancelled.load(Ordering::SeqCst)
                || control.terminal_sent.load(Ordering::SeqCst)
            {
                return;
            }
            // This block is not guaranteed to run on the main thread. Only atomics
            // and `last_partial` are touched here. `CONTROL` is thread-local.
            if !result.is_null() {
                let result = unsafe { result.as_ref() }.unwrap();
                let text = unsafe { result.bestTranscription().formattedString().to_string() };
                let is_final = unsafe { result.isFinal() };
                let event = match control.last_partial.lock() {
                    Ok(mut partial) => {
                        let decision = apply_recognizer_result(&partial, &text, is_final);
                        *partial = decision.last_partial;
                        decision.event
                    }
                    Err(_) => {
                        if is_final {
                            Some(DictationEvent::Final { text })
                        } else if text.trim().is_empty() {
                            None
                        } else {
                            Some(DictationEvent::Partial { text })
                        }
                    }
                };
                if let Some(event) = event {
                    deliver_on_main(&app_for_handler, control, event);
                }
                return;
            }
            if !error.is_null() {
                let ns_err = unsafe { error.as_ref() }.unwrap();
                let detail = ns_err.localizedDescription().to_string();
                let code = ns_err.code() as i64;
                let stopping = control.stopping.load(Ordering::SeqCst);
                let last_partial = control
                    .last_partial
                    .lock()
                    .map(|v| v.clone())
                    .unwrap_or_default();
                if let Some(event) = speech_task_terminal(stopping, &last_partial, code, &detail) {
                    deliver_on_main(&app_for_handler, control, event);
                }
            }
        },
    );
    let task = unsafe {
        recognizer.recognitionTaskWithRequest_resultHandler(request_super, &result_handler)
    };

    LIVE.with(|cell| {
        *cell.borrow_mut() = Some(LiveObjects {
            _recognizer: recognizer,
            engine,
            request,
            task,
            _tap_block: tap_block,
            _result_handler: result_handler,
        });
    });

    emit_dictation_event(&control.channel, DictationEvent::Listening);

    let app_auto = app.clone();
    let control_auto = control.clone();
    let session_id = control.id;
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(DICTATION_AUTO_STOP_SECS));
        let app_stop = app_auto.clone();
        let control_stop = control_auto.clone();
        let _ = app_auto.run_on_main_thread(move || {
            if control_stop.id != session_id || !control_is_current(&control_stop) {
                return;
            }
            stop_session_internal(app_stop, control_stop);
        });
    });
}

fn continue_after_mic(app: AppHandle, control: Arc<SessionControl>) {
    if !control_is_current(&control) || session_aborted(&control) {
        return;
    }
    begin_listening(app, control);
}

fn continue_after_speech(app: AppHandle, control: Arc<SessionControl>) {
    if !control_is_current(&control) || session_aborted(&control) {
        return;
    }
    let Some(media_type) = (unsafe { AVMediaTypeAudio }) else {
        emit_terminal_on_main(&control, error_event("failed", failed_message(None)));
        return;
    };
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
    match status {
        AVAuthorizationStatus::Authorized => continue_after_mic(app, control),
        AVAuthorizationStatus::Denied | AVAuthorizationStatus::Restricted => {
            emit_terminal_on_main(
                &control,
                error_event("microphone_denied", microphone_denied_message()),
            );
        }
        AVAuthorizationStatus::NotDetermined => {
            let app_for_cb = app.clone();
            let control_for_cb = control.clone();
            let block = RcBlock::new(move |granted: Bool| {
                let granted = granted.as_bool();
                let app = app_for_cb.clone();
                let control = control_for_cb.clone();
                let app_main = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if !control_is_current(&control) || session_aborted(&control) {
                        return;
                    }
                    if !granted {
                        emit_terminal_on_main(
                            &control,
                            error_event("microphone_denied", microphone_denied_message()),
                        );
                        return;
                    }
                    continue_after_mic(app_main, control);
                });
            });
            unsafe {
                AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &block);
            }
        }
        _ => emit_terminal_on_main(
            &control,
            error_event("microphone_denied", microphone_denied_message()),
        ),
    }
}

fn start_session_on_main(app: AppHandle, control: Arc<SessionControl>) {
    if !control_is_current(&control) || control.cancelled.load(Ordering::SeqCst) {
        return;
    }
    let status = unsafe { SFSpeechRecognizer::authorizationStatus() };
    match status {
        SFSpeechRecognizerAuthorizationStatus::Authorized => {
            continue_after_speech(app, control);
        }
        SFSpeechRecognizerAuthorizationStatus::Denied
        | SFSpeechRecognizerAuthorizationStatus::Restricted => {
            emit_terminal_on_main(
                &control,
                error_event("speech_denied", speech_denied_message()),
            );
        }
        SFSpeechRecognizerAuthorizationStatus::NotDetermined => {
            let app_for_cb = app.clone();
            let control_for_cb = control.clone();
            let block = RcBlock::new(move |auth: SFSpeechRecognizerAuthorizationStatus| {
                let app = app_for_cb.clone();
                let control = control_for_cb.clone();
                let app_main = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if !control_is_current(&control) || session_aborted(&control) {
                        return;
                    }
                    if auth == SFSpeechRecognizerAuthorizationStatus::Authorized {
                        continue_after_speech(app_main, control);
                    } else {
                        emit_terminal_on_main(
                            &control,
                            error_event("speech_denied", speech_denied_message()),
                        );
                    }
                });
            });
            unsafe { SFSpeechRecognizer::requestAuthorization(&block) };
        }
        _ => emit_terminal_on_main(
            &control,
            error_event("speech_denied", speech_denied_message()),
        ),
    }
}

fn stop_session_internal(_app: AppHandle, control: Arc<SessionControl>) {
    if control.cancelled.load(Ordering::SeqCst) || control.terminal_sent.load(Ordering::SeqCst) {
        return;
    }
    if control.stopping.swap(true, Ordering::SeqCst) {
        return;
    }
    let snapshot = LIVE.with(|cell| {
        cell.borrow()
            .as_ref()
            .map(|live| (live.engine.clone(), live.request.clone(), live.task.clone()))
    });
    if let Some((engine, request, task)) = snapshot {
        let input = unsafe { engine.inputNode() };
        let node = input.as_super().as_super();
        unsafe { node.removeTapOnBus(0) };
        unsafe { engine.stop() };
        // endAudio tells the request no more samples are coming. finish asks
        // the task to produce the final transcript from what it already has.
        unsafe { request.endAudio() };
        unsafe { task.finish() };
    }
    schedule_final_timeout(_app, control);
}

pub fn cancel_session_silent() {
    if let Some(control) = CONTROL.with(|cell| cell.borrow().clone()) {
        control.cancelled.store(true, Ordering::SeqCst);
        release(&control);
    } else {
        LIVE.with(|cell| {
            let _ = cell.borrow_mut().take();
        });
    }
}

pub fn kickoff_session(app: AppHandle, channel: Channel<DictationEvent>, session_id: u64) {
    cancel_session_silent();
    let control = Arc::new(SessionControl {
        id: session_id,
        cancelled: AtomicBool::new(false),
        terminal_sent: AtomicBool::new(false),
        released: AtomicBool::new(false),
        stopping: AtomicBool::new(false),
        audio_buffers: AtomicU64::new(0),
        last_partial: Mutex::new(String::new()),
        channel,
    });
    CONTROL.with(|cell| {
        *cell.borrow_mut() = Some(control.clone());
    });
    start_session_on_main(app, control);
}

pub fn stop_active_session(app: AppHandle) {
    if let Some(control) = CONTROL.with(|cell| cell.borrow().clone()) {
        stop_session_internal(app, control);
    }
}

pub fn cancel_active_session() {
    cancel_session_silent();
}
