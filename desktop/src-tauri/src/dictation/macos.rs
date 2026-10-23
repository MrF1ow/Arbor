use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{Allocated, MainThreadMarker};
use objc2_av_foundation::{
    AVCaptureDevice, AVAuthorizationStatus, AVMediaTypeAudio,
};
use objc2_avf_audio::{AVAudioEngine, AVAudioNode, AVAudioPCMBuffer, AVAudioTime};
use objc2_foundation::NSError;
use objc2_speech::{
    SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionRequest,
    SFSpeechRecognitionResult, SFSpeechRecognitionTask, SFSpeechRecognizer,
    SFSpeechRecognizerAuthorizationStatus,
};
use tauri::AppHandle;
use tauri::ipc::Channel;

use super::{
    emit_dictation_event, error_event, failed_message, DictationEvent, DICTATION_AUTO_STOP_SECS,
    FINAL_TIMEOUT_SECS,
};

struct LiveObjects {
    engine: Retained<AVAudioEngine>,
    request: Retained<SFSpeechAudioBufferRecognitionRequest>,
    task: Retained<SFSpeechRecognitionTask>,
    _tap_block: RcBlock<dyn Fn(core::ptr::NonNull<AVAudioPCMBuffer>, core::ptr::NonNull<AVAudioTime>)>,
    _result_handler: RcBlock<dyn Fn(*mut SFSpeechRecognitionResult, *mut NSError)>,
}

struct SessionControl {
    id: u64,
    cancelled: AtomicBool,
    ended: AtomicBool,
    stopping: AtomicBool,
    last_partial: Mutex<String>,
    channel: Channel<DictationEvent>,
    final_timer: Mutex<Option<thread::JoinHandle<()>>>,
    auto_stop_timer: Mutex<Option<thread::JoinHandle<()>>>,
}

thread_local! {
    static LIVE: RefCell<Option<LiveObjects>> = const { RefCell::new(None) };
    static CONTROL: RefCell<Option<Arc<SessionControl>>> = const { RefCell::new(None) };
}

fn with_control<F, R>(f: F) -> R
where
    F: FnOnce(Option<Arc<SessionControl>>) -> R,
{
    CONTROL.with(|cell| f(cell.borrow().clone()))
}

fn clear_live_objects() {
    LIVE.with(|cell| {
        if let Some(live) = cell.borrow_mut().take() {
            let input = unsafe { live.engine.inputNode() };
            unsafe { input.removeTapOnBus(0) };
            unsafe { live.engine.stop() };
            unsafe { live.task.cancel() };
        }
    });
}

fn tear_down_session(control: &SessionControl) {
    if control.ended.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(handle) = control.final_timer.lock().ok().and_mut(|slot| slot.take()) {
        let _ = handle.join();
    }
    if let Some(handle) = control.auto_stop_timer.lock().ok().and_mut(|slot| slot.take()) {
        let _ = handle.join();
    }
    clear_live_objects();
    CONTROL.with(|cell| {
        if cell
            .borrow()
            .as_ref()
            .is_some_and(|c| c.id == control.id)
        {
            *cell.borrow_mut() = None;
        }
    });
}

fn emit_terminal(control: &SessionControl, event: DictationEvent) {
    if control.cancelled.load(Ordering::SeqCst) {
        tear_down_session(control);
        return;
    }
    if control.ended.swap(true, Ordering::SeqCst) {
        return;
    }
    emit_dictation_event(&control.channel, event);
    tear_down_session(control);
}

fn schedule_final_timeout(app: AppHandle, control: Arc<SessionControl>) {
    let handle = thread::spawn(move || {
        thread::sleep(Duration::from_secs(FINAL_TIMEOUT_SECS));
        let _ = app.run_on_main_thread(move || {
            if control.cancelled.load(Ordering::SeqCst) || control.ended.load(Ordering::SeqCst) {
                return;
            }
            let text = control
                .last_partial
                .lock()
                .map(|v| v.clone())
                .unwrap_or_default();
            emit_terminal(&control, DictationEvent::Final { text });
        });
    });
    if let Ok(mut slot) = control.final_timer.lock() {
        *slot = Some(handle);
    }
}

fn begin_listening(app: AppHandle, control: Arc<SessionControl>) {
    let Some(mtm) = MainThreadMarker::new() else {
        emit_terminal(
            &control,
            error_event("failed", failed_message(None)),
        );
        return;
    };
    let _ = mtm;

    let recognizer = unsafe { SFSpeechRecognizer::new() };
    let Some(recognizer) = recognizer else {
        emit_terminal(
            &control,
            error_event("unavailable", super::unavailable_message()),
        );
        return;
    };
    if !unsafe { recognizer.isAvailable() } {
        emit_terminal(
            &control,
            error_event("unavailable", super::unavailable_message()),
        );
        return;
    }

    let request = unsafe { SFSpeechAudioBufferRecognitionRequest::new() };
    unsafe {
        request.setShouldReportPartialResults(true);
        request.setAddsPunctuation(true);
        if recognizer.supportsOnDeviceRecognition() {
            request.setRequiresOnDeviceRecognition(true);
        }
    }

    let engine = unsafe { AVAudioEngine::new() };
    let input = unsafe { engine.inputNode() };
    let format = unsafe { input.outputFormatForBus(0) };

    let request_for_tap = request.clone();
    let tap_block = RcBlock::new(
        move |buffer: core::ptr::NonNull<AVAudioPCMBuffer>, _when: core::ptr::NonNull<AVAudioTime>| {
            unsafe {
                request_for_tap.appendAudioPCMBuffer(buffer.as_ref());
            }
        },
    );
    let tap_ptr = tap_block.copy();
    unsafe {
        input.installTapOnBus_bufferSize_format_block(0, 1024, Some(&format), tap_ptr);
    }

    unsafe { engine.prepare() };
    if let Err(err) = unsafe { engine.startAndReturnError() } {
        let detail = err.localizedDescription().to_string();
        emit_terminal(
            &control,
            error_event("failed", failed_message(Some(&detail))),
        );
        return;
    }

    let control_for_handler = control.clone();
    let result_handler = RcBlock::new(
        move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
            let control = control_for_handler.clone();
            if control.cancelled.load(Ordering::SeqCst) || control.ended.load(Ordering::SeqCst) {
                return;
            }
            if !result.is_null() {
                let result = unsafe { result.as_ref() }.unwrap();
                let text = unsafe { result.bestTranscription().formattedString().to_string() };
                if let Ok(mut partial) = control.last_partial.lock() {
                    *partial = text.clone();
                }
                if unsafe { result.isFinal() } {
                    emit_terminal(&control, DictationEvent::Final { text });
                } else {
                    emit_dictation_event(&control.channel, DictationEvent::Partial { text });
                }
                return;
            }
            if !error.is_null() {
                let ns_err = unsafe { error.as_ref() }.unwrap();
                let detail = ns_err.localizedDescription().to_string();
                emit_terminal(
                    &control,
                    error_event("failed", failed_message(Some(&detail))),
                );
            }
        },
    );
    let handler_ref = result_handler.copy();
    let task = unsafe {
        recognizer.recognitionTaskWithRequest_resultHandler(
            ProtocolObject::from_ref(request.as_ref()),
            &handler_ref,
        )
    };

    LIVE.with(|cell| {
        *cell.borrow_mut() = Some(LiveObjects {
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
    let auto_handle = thread::spawn(move || {
        thread::sleep(Duration::from_secs(DICTATION_AUTO_STOP_SECS));
        let app_stop = app_auto.clone();
        let _ = app_auto.run_on_main_thread(move || {
            stop_session_internal(app_stop, control_auto);
        });
    });
    if let Ok(mut slot) = control.auto_stop_timer.lock() {
        *slot = Some(auto_handle);
    }
}

fn continue_after_mic(app: AppHandle, control: Arc<SessionControl>) {
    if control.cancelled.load(Ordering::SeqCst) {
        return;
    }
    begin_listening(app, control);
}

fn continue_after_speech(app: AppHandle, control: Arc<SessionControl>) {
    if control.cancelled.load(Ordering::SeqCst) {
        return;
    }
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(AVMediaTypeAudio) };
    match status {
        AVAuthorizationStatus::Authorized => continue_after_mic(app, control),
        AVAuthorizationStatus::Denied | AVAuthorizationStatus::Restricted => {
            emit_terminal(
                &control,
                error_event("microphone_denied", super::microphone_denied_message()),
            );
        }
        AVAuthorizationStatus::NotDetermined => {
            let app_for_cb = app.clone();
            let control_for_cb = control.clone();
            let block = RcBlock::new(move |granted: bool| {
                let app = app_for_cb.clone();
                let control = control_for_cb.clone();
                let _ = app.run_on_main_thread(move || {
                    if !granted {
                        emit_terminal(
                            &control,
                            error_event(
                                "microphone_denied",
                                super::microphone_denied_message(),
                            ),
                        );
                        return;
                    }
                    continue_after_mic(app, control);
                });
            });
            unsafe {
                AVCaptureDevice::requestAccessForMediaType_completionHandler(
                    AVMediaTypeAudio,
                    &block,
                );
            }
        }
        _ => emit_terminal(
            &control,
            error_event("microphone_denied", super::microphone_denied_message()),
        ),
    }
}

fn start_session_on_main(app: AppHandle, control: Arc<SessionControl>) {
    if control.cancelled.load(Ordering::SeqCst) {
        return;
    }
    let status = unsafe { SFSpeechRecognizer::authorizationStatus() };
    match status {
        SFSpeechRecognizerAuthorizationStatus::Authorized => {
            continue_after_speech(app, control);
        }
        SFSpeechRecognizerAuthorizationStatus::Denied
        | SFSpeechRecognizerAuthorizationStatus::Restricted => {
            emit_terminal(
                &control,
                error_event("speech_denied", super::speech_denied_message()),
            );
        }
        SFSpeechRecognizerAuthorizationStatus::NotDetermined => {
            let app_for_cb = app.clone();
            let control_for_cb = control.clone();
            let block = RcBlock::new(
                move |auth: SFSpeechRecognizerAuthorizationStatus| {
                    let app = app_for_cb.clone();
                    let control = control_for_cb.clone();
                    let _ = app.run_on_main_thread(move || {
                        if auth == SFSpeechRecognizerAuthorizationStatus::Authorized {
                            continue_after_speech(app, control);
                        } else {
                            emit_terminal(
                                &control,
                                error_event(
                                    "speech_denied",
                                    super::speech_denied_message(),
                                ),
                            );
                        }
                    });
                },
            );
            unsafe { SFSpeechRecognizer::requestAuthorization(&block) };
        }
        _ => emit_terminal(
            &control,
            error_event("speech_denied", super::speech_denied_message()),
        ),
    }
}

fn stop_session_internal(_app: AppHandle, control: Arc<SessionControl>) {
    if control.cancelled.load(Ordering::SeqCst) || control.ended.load(Ordering::SeqCst) {
        return;
    }
    if control.stopping.swap(true, Ordering::SeqCst) {
        return;
    }
    LIVE.with(|cell| {
        if let Some(live) = cell.borrow().as_ref() {
            unsafe { live.request.endAudio() };
        }
    });
    schedule_final_timeout(_app, control);
}

pub fn cancel_session_silent() {
    if let Some(control) = with_control(|c| c) {
        control.cancelled.store(true, Ordering::SeqCst);
        tear_down_session(&control);
    } else {
        clear_live_objects();
    }
}

pub fn kickoff_session(app: AppHandle, channel: Channel<DictationEvent>, session_id: u64) {
    cancel_session_silent();
    let control = Arc::new(SessionControl {
        id: session_id,
        cancelled: AtomicBool::new(false),
        ended: AtomicBool::new(false),
        stopping: AtomicBool::new(false),
        last_partial: Mutex::new(String::new()),
        channel,
        final_timer: Mutex::new(None),
        auto_stop_timer: Mutex::new(None),
    });
    CONTROL.with(|cell| {
        *cell.borrow_mut() = Some(control.clone());
    });
    start_session_on_main(app, control);
}

pub fn stop_active_session(app: AppHandle) {
    if let Some(control) = with_control(|c| c) {
        stop_session_internal(app, control);
    }
}

pub fn cancel_active_session() {
    cancel_session_silent();
}
