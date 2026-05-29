use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, Timelike, Weekday};
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Serialize)]
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

    let parsed = try_in_duration(&lower, &now, input)
        .or_else(|| try_today_at(&lower, &now, input))
        .or_else(|| try_tomorrow_at(&lower, &now, input))
        .or_else(|| try_weekday(&lower, &now, input))
        .or_else(|| try_month_date(&lower, &now, input))
        .or_else(|| try_bare_time(&lower, &now, input));

    match parsed {
        Some(mut r) => {
            r.title = sanitize_title(r.title);
            r
        }
        None => {
            // Fallback: 1 hour from now
            let fire_at = now + Duration::hours(1);
            ParsedReminder {
                title: sanitize_title(strip_lead(input).to_string()),
                fire_at_ms: fire_at.timestamp_millis(),
                confidence: 0.3,
                human_time: "in 1 hour (guessed — add a time)".to_string(),
            }
        }
    }
}

/// Empty or whitespace-only titles confuse the UI (the prototype card has
/// no graceful "untitled" state). Provide a fixed placeholder so the
/// reminder still surfaces and the user can rename via a future edit flow.
fn sanitize_title(title: String) -> String {
    let t = title.trim();
    if t.is_empty() {
        "untitled".to_string()
    } else {
        t.to_string()
    }
}

// ── Layers ────────────────────────────────────────────────────────────────────

/// "in 10 min", "in 2 hours", "in 1 h", "in 3 days", "1m", "2h", "3d", "5 mins"
fn try_in_duration(lower: &str, now: &DateTime<Local>, raw: &str) -> Option<ParsedReminder> {
    let re = Regex::new(r"\b(?:in\s+)?(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)\b").ok()?;
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

/// "oct 25 at 3pm", "on September 15", "15 September"
fn try_month_date(lower: &str, now: &DateTime<Local>, raw: &str) -> Option<ParsedReminder> {
    use chrono::TimeZone;
    let re_a = Regex::new(r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?\b").ok()?;
    let re_b = Regex::new(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b").ok()?;

    let (month_str, day_num, year_opt) = if let Some(cap) = re_a.captures(lower) {
        let m = cap.get(1)?.as_str();
        let d: u32 = cap.get(2)?.as_str().parse().ok()?;
        let y: Option<i32> = cap.get(3).and_then(|x| x.as_str().parse().ok());
        (m, d, y)
    } else if let Some(cap) = re_b.captures(lower) {
        let d: u32 = cap.get(1)?.as_str().parse().ok()?;
        let m = cap.get(2)?.as_str();
        let y: Option<i32> = cap.get(3).and_then(|x| x.as_str().parse().ok());
        (m, d, y)
    } else {
        return None;
    };

    let month = month_to_num(month_str)?;
    let mut year = year_opt.unwrap_or_else(|| now.year());

    // Extract time if any (e.g. "at 5pm" or "noon"). Defaults to 9:00 AM if not specified.
    let time = extract_time(lower).unwrap_or_else(|| NaiveTime::from_hms_opt(9, 0, 0).unwrap());

    // Try to construct NaiveDate and Local DateTime
    let naive_dt = chrono::NaiveDate::from_ymd_opt(year, month, day_num)?.and_time(time);
    let mut fire_at = match Local.from_local_datetime(&naive_dt) {
        chrono::LocalResult::Single(dt) => Some(dt),
        chrono::LocalResult::Ambiguous(dt, _) => Some(dt),
        chrono::LocalResult::None => None,
    }?;

    // If no year was specified, and the computed time is in the past, move to next year!
    if year_opt.is_none() && fire_at <= *now {
        year += 1;
        let naive_dt = chrono::NaiveDate::from_ymd_opt(year, month, day_num)?.and_time(time);
        fire_at = match Local.from_local_datetime(&naive_dt) {
            chrono::LocalResult::Single(dt) => Some(dt),
            chrono::LocalResult::Ambiguous(dt, _) => Some(dt),
            chrono::LocalResult::None => None,
        }?;
    }

    let title = strip_time_phrase(raw);
    let month_label = month_name(month);
    let time_label = fmt_time(&time);

    let human_time = if year != now.year() {
        format!("on {} {}, {} at {}", month_label, day_num, year, time_label)
    } else {
        format!("on {} {} at {}", month_label, day_num, time_label)
    };

    Some(ParsedReminder {
        title,
        fire_at_ms: fire_at.timestamp_millis(),
        confidence: 0.94,
        human_time,
    })
}

fn month_to_num(m: &str) -> Option<u32> {
    match m {
        "jan" | "january" => Some(1),
        "feb" | "february" => Some(2),
        "mar" | "march" => Some(3),
        "apr" | "april" => Some(4),
        "may" => Some(5),
        "jun" | "june" => Some(6),
        "jul" | "july" => Some(7),
        "aug" | "august" => Some(8),
        "sep" | "sept" | "september" => Some(9),
        "oct" | "october" => Some(10),
        "nov" | "november" => Some(11),
        "dec" | "december" => Some(12),
        _ => None,
    }
}

fn month_name(m: u32) -> &'static str {
    match m {
        1 => "Jan",
        2 => "Feb",
        3 => "Mar",
        4 => "Apr",
        5 => "May",
        6 => "Jun",
        7 => "Jul",
        8 => "Aug",
        9 => "Sep",
        10 => "Oct",
        11 => "Nov",
        12 => "Dec",
        _ => "",
    }
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

    let re_full  = Regex::new(r"(\d{1,2}):(\d{2})\s*(am|pm)?").ok()?;
    let re_short = Regex::new(r"(\d{1,2})\s*(am|pm)").ok()?;

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
    let before = raw[..start].trim_end_matches([' ', ',']);
    let after  = raw[end..].trim_start_matches([' ', ',']);
    let combined = match (before.is_empty(), after.is_empty()) {
        (true,  true)  => String::new(),
        (true,  false) => after.to_string(),
        (false, true)  => before.to_string(),
        (false, false) => format!("{before} {after}"),
    };
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

/// Strip every time-phrase substring from `raw` while preserving the
/// original character casing. Earlier versions ran the regex on the
/// lowercase copy and tried to "find" the result back in raw — which fell
/// through to the lowercase output on any miss, lower-casing the user's
/// titles silently.
///
/// New approach: find time-phrase matches against the lowercase, then
/// splice raw at the SAME byte offsets. Safe when `to_lowercase()`
/// preserves byte length (true for ASCII; English reminders are the
/// overwhelming case). For length-changing lowercase (e.g. ß → ss in
/// non-English titles) we fall back to the lowercase output rather than
/// risk a panicking slice.
fn strip_time_phrase(raw: &str) -> String {
    let re = Regex::new(
        r"(?i)\b(?:remind me to|remind me|remember to|remember|i need to|don'?t forget to|make sure to|make sure)?\s*(?:in\s+\d+\s*(?:mins?|minutes?|hrs?|hours?|days?)|tomorrow|today|next\s+\w+|on\s+\w+day|at\s+\d+(?::\d+)?\s*(?:am|pm)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight|morning|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|on\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+\d{4})?|on\s+\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{4})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{4})?)\b"
    ).expect("strip_time_phrase regex is valid");

    let lower = raw.to_lowercase();

    if lower.len() == raw.len() {
        // ASCII-aligned: splice raw at lowercase match positions, preserving case.
        let mut kept = String::new();
        let mut last_end = 0;
        for m in re.find_iter(&lower) {
            kept.push_str(&raw[last_end..m.start()]);
            last_end = m.end();
        }
        kept.push_str(&raw[last_end..]);
        strip_lead(kept.trim().trim_matches(',').trim()).to_string()
    } else {
        // Non-ASCII lowercase changed length — splicing raw at lower's
        // offsets would mis-slice. Lose case fidelity to stay correct.
        let stripped = re.replace_all(&lower, "");
        strip_lead(stripped.trim().trim_matches(',').trim()).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_in_duration() {
        let p = parse("test project in 1 min");
        assert_eq!(p.title, "test project");
        assert_eq!(p.human_time, "in 1 minute");
        assert!(p.confidence > 0.9);

        let p = parse("test project in 1m");
        assert_eq!(p.title, "test project");
        assert_eq!(p.human_time, "in 1 minute");

        let p = parse("test project 1m");
        assert_eq!(p.title, "test project");
        assert_eq!(p.human_time, "in 1 minute");

        let p = parse("test project 1 min");
        assert_eq!(p.title, "test project");
        assert_eq!(p.human_time, "in 1 minute");

        let p = parse("meeting in 2 hours");
        assert_eq!(p.title, "meeting");
        assert_eq!(p.human_time, "in 2 hours");

        let p = parse("vacation 3d");
        assert_eq!(p.title, "vacation");
        assert_eq!(p.human_time, "in 3 days");
    }

    #[test]
    fn test_title_case_preserved() {
        // Capital letters in the title must round-trip through strip_time_phrase
        // — the previous implementation lowered "Call Mom" to "call mom".
        let p = parse("Call Mom tomorrow at 5pm");
        assert_eq!(p.title, "Call Mom");

        let p = parse("Submit Q3 Report next Monday");
        assert_eq!(p.title, "Submit Q3 Report");
    }

    #[test]
    fn test_empty_input_safe() {
        let p = parse("");
        assert_eq!(p.title, "untitled");

        let p = parse("   ");
        assert_eq!(p.title, "untitled");
    }

    #[test]
    fn test_parse_month_date() {
        // Simple month date
        let p = parse("buy milk on oct 25");
        assert_eq!(p.title, "buy milk");
        assert!(p.human_time.contains("Oct 25"));

        // Day month format
        let p = parse("meeting on 15 September at 3pm");
        assert_eq!(p.title, "meeting");
        assert!(p.human_time.contains("Sep 15"));
        assert!(p.human_time.contains("3 PM"));

        // No time specified (defaults to 9 AM)
        let p = parse("do homework oct 25");
        assert_eq!(p.title, "do homework");
        assert!(p.human_time.contains("Oct 25"));
        assert!(p.human_time.contains("9 AM"));
    }
}
