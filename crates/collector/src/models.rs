use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

pub const SAFE_INT: u64 = 9_007_199_254_740_991;
pub fn id(v: &str, len: usize) -> bool {
    v.len() == len
        && v.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && v.bytes().any(|b| b != b'0')
}
fn nullable<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d)
}
fn present<'de, D>(d: D) -> Result<Option<Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Value::deserialize(d).map(Some)
}
fn uuid(v: &str) -> bool {
    v.len() == 36
        && uuid::Uuid::parse_str(v).is_ok_and(|u| {
            u.is_nil()
                || u == uuid::Uuid::max()
                || (u.get_variant() == uuid::Variant::RFC4122
                    && (1..=8).contains(&u.get_version_num()))
        })
}
fn text(v: &str, max: usize) -> bool {
    !v.is_empty() && v.encode_utf16().count() <= max && !v.chars().any(|c| c.is_control())
}
pub fn json(v: &Value, depth: usize) -> bool {
    if depth > 8 {
        return false;
    }
    match v {
        Value::String(s) => s.encode_utf16().count() <= 32768,
        Value::Array(a) => a.len() <= 1024 && a.iter().all(|v| json(v, depth + 1)),
        Value::Object(o) => {
            o.len() <= 128
                && o.iter()
                    .all(|(k, v)| k.encode_utf16().count() <= 200 && json(v, depth + 1))
        }
        Value::Number(n) => n.as_f64().is_some_and(f64::is_finite),
        _ => true,
    }
}
fn attributes(v: &BTreeMap<String, Value>) -> bool {
    v.len() <= 64
        && v.iter().all(|(k, v)| {
            k.encode_utf16().count() <= 200
                && match v {
                    Value::String(s) => s.encode_utf16().count() <= 4096,
                    Value::Object(_) | Value::Array(_) => false,
                    _ => json(v, 0),
                }
        })
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SafeError {
    pub r#type: String,
    pub message: String,
}
impl SafeError {
    fn valid(&self) -> bool {
        text(&self.r#type, 200) && self.message.encode_utf16().count() <= 4096
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub name: String,
    pub time_unix_ms: u64,
    pub attributes: BTreeMap<String, Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Payload {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub input: Option<Value>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub output: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_truncated: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_truncated: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redacted_paths: Option<Vec<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Span {
    pub schema_version: u8,
    pub trace_id: String,
    pub span_id: String,
    #[serde(deserialize_with = "nullable")]
    pub parent_span_id: Option<String>,
    pub run_id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub start_time_unix_ms: u64,
    pub end_time_unix_ms: u64,
    pub duration_ns: u64,
    pub service_name: String,
    pub attributes: BTreeMap<String, Value>,
    pub events: Vec<Event>,
    #[serde(deserialize_with = "nullable")]
    pub payload: Option<Payload>,
    #[serde(deserialize_with = "nullable")]
    pub error: Option<SafeError>,
}
impl Span {
    pub fn valid(&self) -> bool {
        self.schema_version == 1
            && id(&self.trace_id, 32)
            && id(&self.span_id, 16)
            && self
                .parent_span_id
                .as_ref()
                .is_none_or(|p| id(p, 16) && p != &self.span_id)
            && uuid(&self.run_id)
            && text(&self.name, 200)
            && text(&self.service_name, 100)
            && ["agent", "llm", "tool", "retrieval", "internal"].contains(&self.kind.as_str())
            && ["ok", "error", "cancelled"].contains(&self.status.as_str())
            && self.start_time_unix_ms <= SAFE_INT
            && self.end_time_unix_ms >= self.start_time_unix_ms
            && self.end_time_unix_ms <= SAFE_INT
            && self.duration_ns <= SAFE_INT
            && attributes(&self.attributes)
            && self.events.len() <= 64
            && self.events.iter().all(|e| {
                text(&e.name, 200) && e.time_unix_ms <= SAFE_INT && attributes(&e.attributes)
            })
            && self.error.as_ref().is_none_or(SafeError::valid)
            && self.payload.as_ref().is_none_or(|p| {
                p.input.as_ref().is_none_or(|v| json(v, 0))
                    && p.output.as_ref().is_none_or(|v| json(v, 0))
                    && p.redacted_paths.as_ref().is_none_or(|a| {
                        a.len() <= 128 && a.iter().all(|s| s.encode_utf16().count() <= 512)
                    })
                    && serde_json::to_vec(p).is_ok_and(|s| s.len() <= 32768)
            })
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Run {
    pub run_id: String,
    pub trace_id: String,
    pub service_name: String,
    pub mode: String,
    #[serde(deserialize_with = "nullable")]
    pub replay_of_run_id: Option<String>,
}
impl Run {
    pub fn valid(&self) -> bool {
        uuid(&self.run_id)
            && id(&self.trace_id, 32)
            && text(&self.service_name, 100)
            && match self.mode.as_str() {
                "record" => self.replay_of_run_id.is_none(),
                "replay" => self
                    .replay_of_run_id
                    .as_ref()
                    .is_some_and(|s| uuid(s) && s != &self.run_id),
                _ => false,
            }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub sdk: String,
    pub version: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub schema_version: u8,
    pub source: Source,
    pub run: Run,
    pub spans: Vec<Span>,
}
impl Batch {
    pub fn valid(&self) -> bool {
        self.schema_version == 1
            && self.source.sdk == "tracekit-node"
            && self.source.version == "0.1.0"
            && self.run.valid()
            && !self.spans.is_empty()
            && self.spans.len() <= 100
            && self.spans.iter().all(|s| {
                s.valid()
                    && s.run_id == self.run.run_id
                    && s.trace_id == self.run.trace_id
                    && s.service_name == self.run.service_name
            })
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Outcome {
    Return { value: Value },
    Throw { error: SafeError },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Call {
    pub sequence: u64,
    pub boundary_name: String,
    pub boundary_key: String,
    pub input_hash: String,
    pub outcome: Outcome,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fixture {
    pub fixture_version: u8,
    pub source_run_id: String,
    pub source_trace_id: String,
    pub service_name: String,
    pub created_at_unix_ms: u64,
    pub capture_policy: String,
    pub finalized: bool,
    pub calls: Vec<Call>,
}
impl Fixture {
    pub fn valid(&self) -> bool {
        self.fixture_version == 1
            && uuid(&self.source_run_id)
            && id(&self.source_trace_id, 32)
            && text(&self.service_name, 100)
            && self.created_at_unix_ms <= SAFE_INT
            && self.capture_policy == "explicit-opt-in-sanitized"
            && self.finalized
            && self.calls.len() <= 1000
            && serde_json::to_vec(self).is_ok_and(|s| s.len() <= 786432)
            && self.calls.iter().enumerate().all(|(i, c)| {
                c.sequence == i as u64
                    && text(&c.boundary_name, 200)
                    && c.boundary_key == format!("{}#{}", c.boundary_name, i)
                    && c.boundary_key.encode_utf16().count() <= 230
                    && c.input_hash.starts_with("sha256:")
                    && c.input_hash.len() == 71
                    && c.input_hash[7..]
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    && match &c.outcome {
                        Outcome::Return { value } => json(value, 0),
                        Outcome::Throw { error } => error.valid(),
                    }
            })
    }
}
pub fn acyclic(edges: &[(String, Option<String>)]) -> bool {
    let map: BTreeMap<_, _> = edges
        .iter()
        .map(|(id, parent)| (id.as_str(), parent.as_deref()))
        .collect();
    for start in map.keys() {
        let mut visited = HashSet::new();
        let mut next = Some(*start);
        while let Some(node) = next {
            if !visited.insert(node) {
                return false;
            }
            next = map.get(node).copied().flatten();
        }
    }
    true
}
