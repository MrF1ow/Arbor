use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerTransport {
    Local,
    Ssh {
        host: String,
        port: u16,
        user: Option<String>,
        identity_file: Option<PathBuf>,
        worker_cmd: String,
        remote_root: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedSsh {
    pub host: String,
    pub port: u16,
    pub user: Option<String>,
    pub identity_file: Option<PathBuf>,
    pub worker_tokens: Vec<String>,
    pub remote_root: String,
}

fn is_ascii_whitespace(b: u8) -> bool {
    b == b' ' || b == b'\t' || b == b'\n' || b == b'\r'
}

fn token_allowed(token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    if token
        .bytes()
        .all(|b| matches!(b as char, 'A'..='Z' | 'a'..='z' | '0'..='9' | '.' | '_' | '/' | '@' | ':' | '=' | ',' | '+' | '%' | '-'))
    {
        for component in token.split('/') {
            if component == ".." {
                return false;
            }
        }
        true
    } else {
        false
    }
}

fn remote_token_char_forbidden(c: char) -> bool {
    matches!(
        c,
        '\'' | '"'
            | '$'
            | '`'
            | ';'
            | '|'
            | '&'
            | '<'
            | '>'
            | '('
            | ')'
            | '{'
            | '}'
            | '*'
            | '?'
            | '['
            | ']'
            | '!'
            | '#'
            | '\\'
    ) || matches!(c, '\n' | '\t' | '\r' | '\0')
}

fn remote_token_char_allowed(c: char) -> bool {
    if remote_token_char_forbidden(c) {
        return false;
    }
    if c.is_ascii() {
        return c.is_ascii_alphanumeric()
            || matches!(
                c,
                '.' | '_' | '/' | '@' | ':' | '=' | ',' | '+' | '%' | '-' | ' '
            );
    }
    !c.is_control()
}

fn remote_token_allowed(token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    if !token.chars().all(remote_token_char_allowed) {
        return false;
    }
    for component in token.split('/') {
        if component == ".." {
            return false;
        }
    }
    true
}

fn validate_token_field(field: &str, token: &str) -> Result<(), String> {
    if !token_allowed(token) {
        return Err(format!("{field}: invalid token `{token}`"));
    }
    Ok(())
}

fn validate_remote_token_field(field: &str, token: &str) -> Result<(), String> {
    if !remote_token_allowed(token) {
        return Err(format!("{field}: invalid token `{token}`"));
    }
    Ok(())
}

fn revalidate_ssh_endpoint(endpoint: &ValidatedSsh) -> Result<(), String> {
    validate_label_field("host", &endpoint.host)?;
    if endpoint.port == 0 {
        return Err("port: must be between 1 and 65535".to_string());
    }
    if let Some(user) = &endpoint.user {
        validate_label_field("user", user)?;
    }
    if let Some(path) = &endpoint.identity_file {
        validate_absolute_path_field("identity_file", &path.to_string_lossy())?;
    }
    validate_absolute_path_field("remote_root", &endpoint.remote_root)?;
    Ok(())
}

fn validate_label_field(field: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{field}: required"));
    }
    if value.starts_with('-') {
        return Err(format!("{field}: must not start with `-`"));
    }
    if !value
        .bytes()
        .all(|b| matches!(b as char, 'A'..='Z' | 'a'..='z' | '0'..='9' | '.' | '_' | '-'))
    {
        return Err(format!("{field}: invalid characters"));
    }
    Ok(())
}

fn validate_absolute_path_field(field: &str, path: &str) -> Result<String, String> {
    if path.is_empty() {
        return Err(format!("{field}: required"));
    }
    if !path.starts_with('/') {
        return Err(format!("{field}: must be absolute"));
    }
    if path.starts_with('-') {
        return Err(format!("{field}: must not start with `-`"));
    }
    if !path
        .bytes()
        .all(|b| matches!(b as char, 'A'..='Z' | 'a'..='z' | '0'..='9' | '.' | '_' | '/' | '-'))
    {
        return Err(format!("{field}: invalid characters"));
    }
    let canonical = path.trim_end_matches('/');
    let canonical = if canonical.is_empty() { "/" } else { canonical };
    for component in canonical.split('/').skip(1) {
        if component.is_empty() {
            return Err(format!("{field}: empty path component"));
        }
        if component == ".." {
            return Err(format!("{field}: must not contain `..`"));
        }
    }
    Ok(canonical.to_string())
}

fn validate_rsync_local_path(field: &str, path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err(format!("{field}: required"));
    }
    if !path.starts_with('/') {
        return Err(format!("{field}: must be absolute"));
    }
    if path.starts_with('-') {
        return Err(format!("{field}: must not start with `-`"));
    }
    if !path.bytes().all(|b| {
        b.is_ascii_alphanumeric()
            || matches!(b as char, '.' | '_' | '/' | '-' | ' ')
    }) {
        return Err(format!("{field}: invalid characters"));
    }
    let canonical = path.trim_end_matches('/');
    let canonical = if canonical.is_empty() { "/" } else { canonical };
    for component in canonical.split('/').skip(1) {
        if component.is_empty() {
            return Err(format!("{field}: empty path component"));
        }
        if component == ".." {
            return Err(format!("{field}: must not contain `..`"));
        }
    }
    Ok(())
}

fn validate_rsync_destination(field: &str, destination: &str) -> Result<(), String> {
    if destination.starts_with('/') {
        return validate_rsync_local_path(field, destination);
    }
    let colon = destination
        .find(':')
        .ok_or_else(|| format!("{field}: invalid remote spec"))?;
    let host_part = &destination[..colon];
    let path_part = &destination[colon + 1..];
    if host_part.is_empty() {
        return Err(format!("{field}: invalid remote spec"));
    }
    if let Some(at) = host_part.find('@') {
        let user = &host_part[..at];
        let host = &host_part[at + 1..];
        validate_label_field("user", user)?;
        validate_label_field("host", host)?;
    } else {
        validate_label_field("host", host_part)?;
    }
    validate_rsync_local_path("remote path", path_part)
}

fn split_worker_cmd(worker_cmd: &str) -> Result<Vec<String>, String> {
    let trimmed = worker_cmd.trim();
    if trimmed.is_empty() {
        return Err("worker_cmd: required".to_string());
    }
    let mut tokens = Vec::new();
    let mut current = String::new();
    for b in worker_cmd.bytes() {
        if is_ascii_whitespace(b) {
            if !current.is_empty() {
                validate_token_field("worker_cmd", &current)?;
                tokens.push(current);
                current = String::new();
            }
        } else {
            current.push(b as char);
        }
    }
    if !current.is_empty() {
        validate_token_field("worker_cmd", &current)?;
        tokens.push(current);
    }
    if tokens.is_empty() {
        return Err("worker_cmd: at least one token required".to_string());
    }
    Ok(tokens)
}

pub fn validate_ssh(transport: &WorkerTransport) -> Result<ValidatedSsh, String> {
    let WorkerTransport::Ssh {
        host,
        port,
        user,
        identity_file,
        worker_cmd,
        remote_root,
    } = transport
    else {
        return Err("local transport has no ssh endpoint".to_string());
    };

    validate_label_field("host", host)?;
    if *port == 0 {
        return Err("port: must be between 1 and 65535".to_string());
    }
    if let Some(user) = user {
        validate_label_field("user", user)?;
    }
    let identity = if let Some(path) = identity_file {
        let s = path.to_string_lossy();
        Some(validate_absolute_path_field("identity_file", &s)?)
    } else {
        None
    };
    let remote_root = validate_absolute_path_field("remote_root", remote_root)?;
    let worker_tokens = split_worker_cmd(worker_cmd)?;

    Ok(ValidatedSsh {
        host: host.clone(),
        port: *port,
        user: user.clone(),
        identity_file: identity.map(PathBuf::from),
        worker_tokens,
        remote_root,
    })
}

pub fn quote_remote_token(token: &str) -> Result<String, String> {
    validate_remote_token_field("remote token", token)?;
    Ok(format!("'{token}'"))
}

pub fn quote_remote_command(tokens: &[String]) -> Result<String, String> {
    let mut quoted = Vec::with_capacity(tokens.len());
    for token in tokens {
        quoted.push(quote_remote_token(token)?);
    }
    Ok(quoted.join(" "))
}

pub fn arbor_known_hosts_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("ssh").join("known_hosts")
}

pub fn ssh_argv(
    endpoint: &ValidatedSsh,
    known_hosts: &Path,
    remote_tokens: &[String],
) -> Result<Vec<String>, String> {
    revalidate_ssh_endpoint(endpoint)?;
    if remote_tokens.is_empty() {
        return Err("remote command: at least one token required".to_string());
    }
    for token in remote_tokens {
        validate_remote_token_field("remote token", token)?;
    }
    let known_hosts_str = known_hosts.to_string_lossy();
    validate_absolute_path_field("known_hosts", &known_hosts_str)?;

    let remote_command = quote_remote_command(remote_tokens)?;

    let mut argv = vec![
        "ssh".to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        format!("UserKnownHostsFile={known_hosts_str}"),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-p".to_string(),
        endpoint.port.to_string(),
    ];

    if let Some(identity) = &endpoint.identity_file {
        let id = identity.to_string_lossy();
        validate_absolute_path_field("identity_file", &id)?;
        argv.push("-i".to_string());
        argv.push(id.into_owned());
    }
    if let Some(user) = &endpoint.user {
        validate_label_field("user", user)?;
        argv.push("-l".to_string());
        argv.push(user.clone());
    }

    validate_label_field("host", &endpoint.host)?;
    argv.push("--".to_string());
    argv.push(endpoint.host.clone());
    argv.push(remote_command);
    Ok(argv)
}

pub fn root_id_for(knowledge_root: &str) -> String {
    let trimmed = knowledge_root.trim_end_matches('/');
    let digest = Sha256::digest(trimmed.as_bytes());
    digest[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn validate_root_id(root_id: &str) -> Result<(), String> {
    if root_id.len() != 16
        || !root_id
            .bytes()
            .all(|b| matches!(b as char, 'a'..='f' | '0'..='9'))
    {
        return Err("root_id: must be 16 lowercase hex characters".to_string());
    }
    Ok(())
}

fn validate_course(course: &str) -> Result<(), String> {
    if course.is_empty() {
        return Err("course: required".to_string());
    }
    if course.starts_with('-') {
        return Err("course: must not start with `-`".to_string());
    }
    if course == "." || course == ".." {
        return Err("course: invalid name".to_string());
    }
    if course.contains('/') || course.contains('\\') {
        return Err("course: must be a single path segment".to_string());
    }
    if !course.chars().all(remote_token_char_allowed) {
        return Err("course: invalid characters".to_string());
    }
    Ok(())
}

pub fn remote_knowledge_root(remote_root: &str, root_id: &str) -> Result<String, String> {
    let remote_root = validate_absolute_path_field("remote_root", remote_root)?;
    validate_root_id(root_id)?;
    Ok(format!("{remote_root}/{root_id}"))
}

pub fn remote_course_dir(remote_root: &str, root_id: &str, course: &str) -> Result<String, String> {
    validate_course(course)?;
    let base = remote_knowledge_root(remote_root, root_id)?;
    Ok(format!("{base}/{course}"))
}

pub fn rsync_remote_spec(endpoint: &ValidatedSsh, remote_dir: &str) -> Result<String, String> {
    revalidate_ssh_endpoint(endpoint)?;
    validate_rsync_local_path("remote_dir", remote_dir)?;
    validate_label_field("host", &endpoint.host)?;
    let spec = if let Some(user) = &endpoint.user {
        validate_label_field("user", user)?;
        format!("{user}@{}:{remote_dir}/", endpoint.host)
    } else {
        format!("{}:{remote_dir}/", endpoint.host)
    };
    Ok(spec)
}

fn quote_sh_single(path: &str, field: &str) -> Result<String, String> {
    validate_absolute_path_field(field, path)?;
    Ok(format!("'{path}'"))
}

pub fn rsync_ssh_wrapper(
    app_data_dir: &Path,
    endpoint: &ValidatedSsh,
    known_hosts: &Path,
) -> Result<(PathBuf, String), String> {
    revalidate_ssh_endpoint(endpoint)?;
    let wrapper_path = app_data_dir.join("ssh").join("rsh");
    let wrapper_str = wrapper_path.to_string_lossy();
    validate_absolute_path_field("wrapper path", &wrapper_str)?;

    let known_hosts_str = known_hosts.to_string_lossy();
    validate_absolute_path_field("known_hosts", &known_hosts_str)?;

    let kh = quote_sh_single(&known_hosts_str, "known_hosts")?;
    let port = endpoint.port.to_string();

    let mut parts = vec![
        "#!/bin/sh".to_string(),
        format!(
            "exec ssh -o BatchMode=yes -o UserKnownHostsFile={kh} -o StrictHostKeyChecking=accept-new -p {port}"
        ),
    ];

    if let Some(identity) = &endpoint.identity_file {
        let id = identity.to_string_lossy();
        let quoted = quote_sh_single(&id, "identity_file")?;
        parts[1].push_str(&format!(" -i {quoted}"));
    }
    parts[1].push_str(" \"$@\"");

    Ok((wrapper_path, parts.join("\n")))
}

pub fn rsync_argv(wrapper: &Path, source: &str, destination: &str) -> Result<Vec<String>, String> {
    let wrapper_str = wrapper.to_string_lossy();
    validate_absolute_path_field("wrapper", &wrapper_str)?;
    validate_rsync_local_path("source", source)?;
    validate_rsync_destination("destination", destination)?;
    Ok(vec![
        "rsync".to_string(),
        "-a".to_string(),
        "-e".to_string(),
        wrapper_str.into_owned(),
        source.to_string(),
        destination.to_string(),
    ])
}

pub fn map_ssh_error(stderr: &str, exit_code: i32) -> String {
    let upper = stderr.to_uppercase();
    if upper.contains("REMOTE HOST IDENTIFICATION HAS CHANGED")
        || stderr.contains("Host key verification failed")
    {
        return "host key mismatch: the server key does not match the key Arbor saved; Arbor will not update the user's known_hosts"
            .to_string();
    }
    if stderr.contains("Permission denied")
        || stderr.contains("Authentication failed")
        || stderr.contains("Too many authentication failures")
    {
        return "SSH authentication failed".to_string();
    }
    if stderr.contains("command not found") || exit_code == 127 {
        return "the remote worker command was not found".to_string();
    }
    if stderr.contains("Connection refused")
        || stderr.contains("Could not resolve hostname")
        || stderr.contains("No route to host")
    {
        return "could not connect to the remote host".to_string();
    }
    let trimmed = stderr.trim();
    let capped = truncate_utf8_prefix(trimmed, 400);
    format!("ssh failed (exit {exit_code}): {capped}")
}

fn truncate_utf8_prefix(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live_endpoint() -> ValidatedSsh {
        validate_ssh(&WorkerTransport::Ssh {
            host: "127.0.0.1".to_string(),
            port: 22222,
            user: None,
            identity_file: Some(PathBuf::from("/tmp/arbor-r14/ssh/client_key")),
            worker_cmd: "uv run --project /opt/arbor/python arbor-worker".to_string(),
            remote_root: "/tmp/arbor-r14/remote".to_string(),
        })
        .expect("live endpoint")
    }

    #[test]
    fn ssh_argv_shape_and_safety() {
        let app_data = PathBuf::from("/tmp/arbor-app-data");
        let known = arbor_known_hosts_path(&app_data);
        let endpoint = live_endpoint();
        let remote_tokens: Vec<String> = vec![
            "uv".into(),
            "run".into(),
            "--project".into(),
            "/opt/arbor/python".into(),
            "arbor-worker".into(),
            "--version".into(),
        ];
        let argv = ssh_argv(&endpoint, &known, &remote_tokens).expect("argv");

        assert!(argv.contains(&"BatchMode=yes".to_string()));
        assert!(argv.iter().any(|a| a.starts_with("UserKnownHostsFile=")));
        let kh_arg = argv
            .iter()
            .find(|a| a.starts_with("UserKnownHostsFile="))
            .unwrap();
        assert!(kh_arg.contains(&known.to_string_lossy().to_string()));
        assert!(argv.contains(&"StrictHostKeyChecking=accept-new".to_string()));
        assert!(argv.contains(&"-p".to_string()));
        assert!(argv.contains(&"22222".to_string()));
        let dash_dash = argv.iter().position(|a| a == "--").expect("--");
        let host_pos = argv.iter().position(|a| a == "127.0.0.1").expect("host");
        assert!(dash_dash < host_pos);
        assert_eq!(argv.last().unwrap().matches('\'').count(), 12);
        let remote_cmd = argv.last().unwrap();
        assert!(remote_cmd.contains("'--project'"));
        assert!(remote_cmd.contains("'--version'"));

        for el in &argv {
            assert_ne!(el.as_str(), "sh");
            assert_ne!(el.as_str(), "bash");
            assert_ne!(el.as_str(), "-c");
            assert!(!el.contains(".ssh/known_hosts"));
            assert!(!el.contains("~/.ssh"));
        }
    }

    #[test]
    fn injection_refusal() {
        assert!(validate_ssh(&WorkerTransport::Ssh {
            host: "-oProxyCommand=evil".into(),
            port: 22,
            user: None,
            identity_file: None,
            worker_cmd: "echo".into(),
            remote_root: "/tmp/x".into(),
        })
        .unwrap_err()
        .contains("host"));

        assert!(validate_ssh(&WorkerTransport::Ssh {
            host: "h".into(),
            port: 22,
            user: Some("-l".into()),
            identity_file: None,
            worker_cmd: "echo".into(),
            remote_root: "/tmp/x".into(),
        })
        .unwrap_err()
        .contains("user"));

        assert!(validate_ssh(&WorkerTransport::Ssh {
            host: "h".into(),
            port: 22,
            user: None,
            identity_file: Some(PathBuf::from("-i")),
            worker_cmd: "echo".into(),
            remote_root: "/tmp/x".into(),
        })
        .unwrap_err()
        .contains("identity_file"));

        for bad_root in ["/tmp/../etc", "relative/path", "/tmp/foo;rm"] {
            assert!(
                validate_ssh(&WorkerTransport::Ssh {
                    host: "h".into(),
                    port: 22,
                    user: None,
                    identity_file: None,
                    worker_cmd: "echo".into(),
                    remote_root: bad_root.into(),
                })
                .is_err(),
                "root {bad_root}"
            );
        }

        for bad_token in ["foo;rm", "$(id)", "foo`bar"] {
            assert!(
                validate_ssh(&WorkerTransport::Ssh {
                    host: "h".into(),
                    port: 22,
                    user: None,
                    identity_file: None,
                    worker_cmd: format!("worker {bad_token}"),
                    remote_root: "/tmp/x".into(),
                })
                .is_err(),
                "token {bad_token}"
            );
        }

        assert!(remote_course_dir("/tmp/r", "0123456789abcdef", "..").is_err());
        assert!(remote_course_dir("/tmp/r", "0123456789abcdef", "-rf").is_err());
        assert!(remote_knowledge_root("/tmp/r", "not16hexchars!!").is_err());
    }

    #[test]
    fn known_hosts_path_used_in_ssh_argv() {
        let app_data = PathBuf::from("/var/tmp/arbor-test-app");
        let known = arbor_known_hosts_path(&app_data);
        assert!(known.ends_with("ssh/known_hosts"));
        let endpoint = live_endpoint();
        let argv = ssh_argv(&endpoint, &known, &["true".into()]).unwrap();
        let kh = argv
            .iter()
            .find(|a| a.starts_with("UserKnownHostsFile="))
            .unwrap();
        assert_eq!(kh, &format!("UserKnownHostsFile={}", known.display()));
    }

    #[test]
    fn rsync_wrapper_and_argv() {
        let app_data = PathBuf::from("/tmp/arbor-app-data");
        let known = arbor_known_hosts_path(&app_data);
        let endpoint = live_endpoint();
        let (wrapper, body) = rsync_ssh_wrapper(&app_data, &endpoint, &known).unwrap();
        assert_eq!(wrapper, app_data.join("ssh").join("rsh"));
        assert!(body.contains("exec ssh"));
        assert!(body.contains("BatchMode=yes"));
        assert!(body.contains("StrictHostKeyChecking=accept-new"));
        assert!(body.contains(&known.to_string_lossy().to_string()));
        assert!(!body.contains("~/.ssh"));

        let root_id = root_id_for("/tmp/Knowledge");
        let course_dir =
            remote_course_dir("/tmp/arbor-r14/remote", &root_id, "demo").unwrap();
        let spec = rsync_remote_spec(&endpoint, &course_dir).unwrap();
        assert_eq!(
            spec,
            format!("127.0.0.1:{course_dir}/")
        );
        assert!(!spec.contains(';'));

        let argv = rsync_argv(&wrapper, "/local/src", &spec).unwrap();
        assert_eq!(argv[0], "rsync");
        assert_eq!(argv[1], "-a");
        assert_eq!(argv[2], "-e");
        assert_eq!(argv[3], wrapper.to_string_lossy());
        assert_eq!(argv[4], "/local/src");
        assert_eq!(argv[5], spec);
    }

    #[test]
    fn map_ssh_error_cases() {
        let mismatch = map_ssh_error(
            "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n",
            255,
        );
        assert!(mismatch.contains("host key mismatch"));
        assert!(!mismatch.contains("~/.ssh"));

        let auth = map_ssh_error("Permission denied (publickey).", 255);
        assert!(auth.to_lowercase().contains("authentication failed"));

        let not_found = map_ssh_error("bash: uv: command not found", 127);
        assert!(not_found.contains("worker command was not found"));

        let refused = map_ssh_error("ssh: connect to host 127.0.0.1 port 22: Connection refused", 255);
        assert!(refused.contains("could not connect"));
    }

    #[test]
    fn root_id_for_trailing_slash() {
        let a = root_id_for("/tmp/Knowledge/");
        let b = root_id_for("/tmp/Knowledge");
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
        assert!(a.bytes().all(|c| matches!(c as char, 'a'..='f' | '0'..='9')));
    }

    #[test]
    fn local_transport_rejected_by_validate_ssh() {
        assert_eq!(
            validate_ssh(&WorkerTransport::Local).unwrap_err(),
            "local transport has no ssh endpoint"
        );
    }

    #[test]
    fn validated_ssh_direct_construction_rejected() {
        let hostile = ValidatedSsh {
            host: "-oProxyCommand=evil".into(),
            port: 22,
            user: Some("a;rm".into()),
            identity_file: None,
            worker_tokens: vec!["echo".into()],
            remote_root: "/tmp/x".into(),
        };
        let known = PathBuf::from("/tmp/arbor-app-data/ssh/known_hosts");
        assert!(ssh_argv(&hostile, &known, &["true".into()]).is_err());
        assert!(rsync_remote_spec(&hostile, "/tmp/y").is_err());
        assert!(rsync_ssh_wrapper(
            &PathBuf::from("/tmp/arbor-app-data"),
            &hostile,
            &known
        )
        .is_err());

        let bad_port = ValidatedSsh {
            host: "127.0.0.1".into(),
            port: 0,
            user: None,
            identity_file: None,
            worker_tokens: vec!["echo".into()],
            remote_root: "/tmp/x".into(),
        };
        assert!(ssh_argv(&bad_port, &known, &["true".into()]).is_err());
    }

    #[test]
    fn ssh_argv_rejects_empty_remote_command() {
        let endpoint = live_endpoint();
        let known = arbor_known_hosts_path(&PathBuf::from("/tmp/arbor-app-data"));
        let err = ssh_argv(&endpoint, &known, &[]).unwrap_err();
        assert!(err.contains("remote command"));
    }

    #[test]
    fn rsync_argv_rejects_unsafe_paths() {
        let wrapper = PathBuf::from("/tmp/arbor-app-data/ssh/rsh");
        assert!(rsync_argv(&wrapper, "foo;rm -rf", "/tmp/safe").is_err());
        assert!(rsync_argv(&wrapper, "/tmp/safe", "127.0.0.1:/tmp/x;id").is_err());
        assert!(rsync_argv(&wrapper, "/tmp/../etc/passwd", "/tmp/safe").is_err());
        assert!(rsync_argv(&wrapper, "/tmp/safe", "-rf").is_err());
    }

    #[test]
    fn course_names_with_spaces_and_remote_tokens() {
        let root_id = "0123456789abcdef";
        let course_dir =
            remote_course_dir("/tmp/arbor-r14/remote", root_id, "Behavioral Medicine").unwrap();
        assert_eq!(
            course_dir,
            "/tmp/arbor-r14/remote/0123456789abcdef/Behavioral Medicine"
        );

        let quoted = quote_remote_token("Behavioral Medicine").unwrap();
        assert_eq!(quoted, "'Behavioral Medicine'");

        assert!(quote_remote_token("foo;rm").is_err());
        assert!(remote_course_dir("/tmp/r", root_id, "../etc").is_err());
    }

    #[test]
    fn rsync_argv_accepts_spaced_course_remote_spec() {
        let app_data = PathBuf::from("/tmp/arbor-app-data");
        let wrapper = app_data.join("ssh").join("rsh");
        let endpoint = live_endpoint();
        let root_id = root_id_for("/tmp/Knowledge");
        let course_dir =
            remote_course_dir("/tmp/arbor-r14/remote", &root_id, "Behavioral Medicine").unwrap();
        let spec = rsync_remote_spec(&endpoint, &course_dir).unwrap();
        assert!(spec.contains("Behavioral Medicine"));
        assert!(rsync_argv(&wrapper, "/local/course data", &spec).is_ok());
    }

    #[test]
    fn map_ssh_error_truncates_on_char_boundary() {
        let prefix = "x".repeat(398);
        let stderr = format!("{prefix}étail");
        assert!(stderr.len() > 400);
        let msg = map_ssh_error(&stderr, 1);
        assert!(msg.starts_with("ssh failed (exit 1): "));
        assert!(!msg.contains('é') || msg.len() < stderr.len() + 20);
    }
}
