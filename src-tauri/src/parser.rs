use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, Timelike, Weekday};
use regex::Regex;

#[derive(Debug)]
pub struct ParsedReminder {
    pub title: String,
    pub fire_at_ms: i64,
    pub confidence: f32,
    pub human_time: String,
}

pub fn parse(raw: &str) -> ParsedReminder {
    let input = raw.trim();
    let lower = input.to_lowercase();
    let now = Local::now();

    if let Some(r) = try_in_duration(&lower, &now, input) { return r; }
    if let Some(r) = try_today_at(&lower, &now, input)    { return r; }
    if let Some(r) = try_tomorrow_at(&lower, &now, input) { return r; }
    if let Some(r) = try_weekday(&lower, &now, input)     { return r; }
    if let Some(r) = try_bare_time(&lower, &now, input)   { return r; }

    // Fallback: 1 hour from now
    let fire_at = now + Duration::hours(1);
    ParsedReminder {
        title: strip_lead(input).to_string(),
        fire_at_ms: fire_at.timestamp_millis(),
        confidence: 0.3,
        human_time: "in 1 hour (guessed — add a time)".to_string(),
    }
}

// ── Layers ────────────────────────────────────────────────────────────────────

/// "in 10 min", "in 2 hours", "in 1 h", "in 3 days", "1m", "2h", "3d", "5 mins"
fn try_in_duration(lower: &str, now: &DateTime<Local>, raw: &str) -> Option<ParsedReminder> {
    // Matches "in 10 min", "in 1m", "2h", "3d", etc. Optional "in" prefix, support m/h/d shorthand.
    let re = Regex::new(r"\b(?:in\s+)?(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)\b").unwrap();
    let cap = re.captures(lower)?;
    let n: i64 = cap[1].parse().ok()?;
    let unit = cap[2].to_lowercase();

    let (fire_at, label) = if unit.starts_with('m') {
        (*now + Duration::minutes(n), format!("in {} minute{}", n, if n != 1 { "s" } else { "" }))
    } else if unit.starts_with('h') {
        (*now + Duration::hours(n), format!("in {} hour{}", n, if n != 1 { "s" } else { "" }))
    } else {
        (*now + Duration::days(n), format!("in {} day{}", n, if n != 1 { "s" } else { "" }))
    };

    let mat = re.find(lower)?;
    let title = excise(raw, mat.start(), mat.end());

    Some(ParsedReminder {
        title,
        fire_at_ms: fire_at.timestamp_millis(),
        confidence: 0.95,
        human_time: label,
    })
}


/// "today at 3pm", "at 3:30 today"
fn try_today_at(lower: &str, now: &DateTime<Local>, raw: &str) -> Option<ParsedReminder> {
    if !lower.contains("today") { return None; }
    let time = extract_time(lower)?;
    let mut fire_at = local_at(now, &time)?;
    if fire_at <= *now { fire_at = fire_at + Duration::days(1); }
    let title = strip_time_phrase(raw);
    Some(ParsedReminder {
        title,
        fire_at_ms: fire_at.timestamp_millis(),
        confidence: 0.92,
        human_time: format!("today at {}", fmt_time(&time)),
    })
}

/// "tomorrow at 6pm", "tomorrow morning"
fn try_tomorrow_at(lower: &str, now: &DateTime<Local>, raw: &str) -> Option<ParsedReminder> {
    if !lower.contains("tomorrow") { return None; }
    let base = *now + Duration::days(1);
    let time = extract_time(lower).unwrap_or_else(|| NaiveTime::from_hms_opt(9, 0, 0).unwrap());
    let fire_at = local_at(&base, &time)?;
    let title = strip_time_phrase(raw);
    Some(ParsedReminder {
        title,
        fire_at_ms: fire_at.timestamp_millis(),
        confidence: 0.93,
        human_time: format!("tomorrow at {}", fmt_time(&time)),
    })
}

/// "next monday at 3pm", "friday morning"
fn try_weekday(lower: &str, now: &DateTime<Local>, raw: &str) -> Option<ParsedReminder> {
    let days = [
        ("monday",    Weekday::Mon), ("tuesday",  Weekday::Tue),
        ("wednesday", Weekday::Wed), ("thursday", Weekday::Thu),
        ("friday",    Weekday::Fri), ("saturday", Weekday::Sat),
        ("sunday",    Weekday::Sun),
    ];
    for (name, wd) in &days {
        if lower.contains(name) {
            let ahead = days_until(now.weekday(), *wd, lower.contains("next"));
            let base  = *now + Duration::days(ahead);
            let time  = extract_time(lower).unwrap_or_else(|| NaiveTime::from_hms_opt(9, 0, 0).unwrap());
            let fire_at = local_at(&base, &time)?;
            let title = strip_time_phrase(raw);
            let day_label = if lower.contains("next") { format!("next {name}") } else { (*name).to_string() };
            return Some(ParsedReminder {
                title,
                fire_at_ms: fire_at.timestamp_millis(),
                confidence: 0.88,
                human_time: format!("{day_label} at {}", fmt_time(&time)),
            });
        }
    }
    None
}

/// Bare "at 5pm" → today if ahead, else tomorrow
fn try_bare_time(lower: &str, now: &DateTime<Local>, raw: &str) -> Option<ParsedReminder> {
    let time = extract_time(lower)?;
    let mut fire_at = local_at(now, &time)?;
    if fire_at <= *now { fire_at = fire_at + Duration::days(1); }
    let title = strip_time_phrase(raw);
    Some(ParsedReminder {
        title,
        fire_at_ms: fire_at.timestamp_millis(),
        confidence: 0.80,
        human_time: format!("at {}", fmt_time(&time)),
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn local_at(base: &DateTime<Local>, time: &NaiveTime) -> Option<DateTime<Local>> {
    use chrono::TimeZone;
    let naive = base.date_naive().and_time(*time);
    match Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt)        => Some(dt),
        chrono::LocalResult::Ambiguous(dt, _)  => Some(dt),
        chrono::LocalResult::None              => None,
    }
}

fn extract_time(lower: &str) -> Option<NaiveTime> {
    if lower.contains("noon")     { return NaiveTime::from_hms_opt(12,  0, 0); }
    if lower.contains("midnight") { return NaiveTime::from_hms_opt( 0,  0, 0); }
    if lower.contains("morning")  { return NaiveTime::from_hms_opt( 8,  0, 0); }
    if lower.contains("evening")  { return NaiveTime::from_hms_opt(18,  0, 0); }
    if lower.contains("night")    { return NaiveTime::from_hms_opt(21,  0, 0); }

    let re_full  = Regex::new(r"(\d{1,2}):(\d{2})\s*(am|pm)?").unwrap();
    let re_short = Regex::new(r"(\d{1,2})\s*(am|pm)").unwrap();

    if let Some(cap) = re_full.captures(lower) {
        let mut h: u32 = cap[1].parse().ok()?;
        let m: u32      = cap[2].parse().ok()?;
        if let Some(mer) = cap.get(3) {
            let mer = mer.as_str();
            if mer == "pm" && h < 12 { h += 12; }
            if mer == "am" && h == 12 { h = 0; }
        }
        return NaiveTime::from_hms_opt(h, m, 0);
    }
    if let Some(cap) = re_short.captures(lower) {
        let mut h: u32 = cap[1].parse().ok()?;
        if &cap[2] == "pm" && h < 12 { h += 12; }
        if &cap[2] == "am" && h == 12 { h  = 0; }
        return NaiveTime::from_hms_opt(h, 0, 0);
    }
    None
}

fn days_until(current: Weekday, target: Weekday, force_next: bool) -> i64 {
    let c = current.num_days_from_monday() as i64;
    let t = target.num_days_from_monday() as i64;
    let mut diff = t - c;
    if diff <= 0 || force_next { diff += 7; }
    diff
}

fn fmt_time(t: &NaiveTime) -> String {
    let h = t.hour();
    let m = t.minute();
    let (suf, h12) = if h >= 12 { ("PM", if h > 12 { h - 12 } else { h }) }
                    else { ("AM", if h == 0 { 12 } else { h }) };
    if m == 0 { format!("{h12} {suf}") } else { format!("{h12}:{m:02} {suf}") }
}

/// Remove the time phrase at [start, end) from raw, clean up, strip lead verbs.
fn excise(raw: &str, start: usize, end: usize) -> String {
    let lower = raw.to_lowercase();
    // Find byte offsets in raw corresponding to lower's char-aligned positions
    let before = raw[..start].trim_end_matches([' ', ',']);
    let after  = raw[end..].trim_start_matches([' ', ',']);
    let combined = match (before.is_empty(), after.is_empty()) {
        (true,  true)  => raw.to_string(),
        (true,  false) => after.to_string(),
        (false, true)  => before.to_string(),
        (false, false) => format!("{before} {after}"),
    };
    let _ = lower; // suppress warning
    strip_lead(combined.trim()).to_string()
}

fn strip_lead(s: &str) -> &str {
    let prefixes = [
        "remind me to ", "remind me ", "remember to ", "remember ",
        "i need to ", "don't forget to ", "dont forget to ",
        "make sure to ", "make sure ",
    ];
    for p in prefixes {
        if s.to_lowercase().starts_with(p) {
            return &s[p.len()..];
        }
    }
    s
}

fn strip_time_phrase(raw: &str) -> String {
    // Matches "in N min/h/day", "tomorrow", "today", "next <day>", "at Hpm",
    // "noon/midnight/morning/evening/night", day names
    let re = Regex::new(
        r"(?i)\b(?:remind me to|remind me|remember to|remember|i need to|don'?t forget to|make sure to|make sure)?\s*(?:in\s+\d+\s*(?:mins?|minutes?|hrs?|hours?|days?)|tomorrow|today|next\s+\w+|on\s+\w+day|at\s+\d+(?::\d+)?\s*(?:am|pm)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight|morning|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b"
    ).unwrap();
    let lower_owned = raw.to_lowercase();
    let result = re.replace_all(&lower_owned, "");
    let result = result.trim().trim_matches(',').trim().to_string();
    if result.is_empty() {
        strip_lead(raw.trim()).to_string()
    } else {
        // Restore original casing from raw by finding first non-stripped portion
        let lower = raw.to_lowercase();
        if let Some(pos) = lower.find(result.as_str()) {
            strip_lead(&raw[pos..raw.len().min(pos + result.len())]).to_string()
        } else {
            strip_lead(result.trim()).to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_in_duration() {
        // "in 1 min"
        let p = parse("test project in 1 min");
        assert_eq!(p.title, "test project");
        assert_eq!(p.human_time, "in 1 minute");
        assert!(p.confidence > 0.9);

        // "in 1m"
        let p = parse("test project in 1m");
        assert_eq!(p.title, "test project");
        assert_eq!(p.human_time, "in 1 minute");

        // "1m"
        let p = parse("test project 1m");
        assert_eq!(p.title, "test project");
        assert_eq!(p.human_time, "in 1 minute");

        // "1 min" (no prefix)
        let p = parse("test project 1 min");
        assert_eq!(p.title, "test project");
        assert_eq!(p.human_time, "in 1 minute");

        // "in 2 hours"
        let p = parse("meeting in 2 hours");
        assert_eq!(p.title, "meeting");
        assert_eq!(p.human_time, "in 2 hours");

        // "3d"
        let p = parse("vacation 3d");
        assert_eq!(p.title, "vacation");
        assert_eq!(p.human_time, "in 3 days");
    }
}


