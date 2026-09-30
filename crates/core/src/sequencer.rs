use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub beat: f64,
    pub pad: u8,
    pub velocity: f32,
    pub nudge: f64,
    #[serde(default)]
    pub pitch: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Groove {
    pub grid: f64,
    pub strength: f64,
    pub swing: f64,
}

impl Default for Groove {
    fn default() -> Self {
        Self { grid: 0.25, strength: 0.0, swing: 0.5 }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pattern {
    length_beats: f64,
    events: Vec<Event>,
    groove: Groove,
    #[serde(skip)]
    placed: Vec<(f64, usize)>,
}

impl Pattern {
    pub fn new(length_beats: f64) -> Self {
        Self { length_beats, events: Vec::new(), groove: Groove::default(), placed: Vec::new() }
    }

    pub fn length_beats(&self) -> f64 {
        self.length_beats
    }

    pub fn events(&self) -> &[Event] {
        &self.events
    }

    pub fn groove(&self) -> Groove {
        self.groove
    }

    pub fn set_length_beats(&mut self, length_beats: f64) {
        self.length_beats = length_beats;
        self.reposition();
    }

    pub fn set_groove(&mut self, groove: Groove) {
        self.groove = groove;
        self.reposition();
    }

    pub fn push(&mut self, event: Event) {
        self.events.push(event);
        self.reposition();
    }

    pub fn clear(&mut self) {
        self.events.clear();
        self.placed.clear();
    }

    pub fn reserve(&mut self, additional: usize) {
        self.events.reserve(additional);
        self.placed.reserve(additional);
    }

    pub fn placed_beat(&self, event: &Event) -> f64 {
        let g = self.groove;
        let k = (event.beat / g.grid).round();
        let target = if k as i64 % 2 != 0 {
            (k - 1.0) * g.grid + 2.0 * g.grid * g.swing
        } else {
            k * g.grid
        };
        let placed = event.beat + (target - event.beat) * g.strength + event.nudge;
        placed.rem_euclid(self.length_beats)
    }

    pub fn for_each_in_span(&self, start_beat: f64, span_beats: f64, mut f: impl FnMut(f64, &Event)) {
        let start = start_beat.rem_euclid(self.length_beats);
        let end = start + span_beats;
        self.visit(start, end.min(self.length_beats), 0.0, &mut f);
        if end > self.length_beats {
            let head = self.length_beats - start;
            self.visit(0.0, end - self.length_beats, head, &mut f);
        }
    }

    fn visit(&self, from: f64, to: f64, base: f64, f: &mut impl FnMut(f64, &Event)) {
        let first = self.placed.partition_point(|(b, _)| *b < from);
        for &(beat, index) in self.placed[first..].iter().take_while(|(b, _)| *b < to) {
            f(base + beat - from, &self.events[index]);
        }
    }

    fn reposition(&mut self) {
        self.placed.clear();
        for (i, e) in self.events.iter().enumerate() {
            self.placed.push((self.placed_beat(e), i));
        }
        self.placed.sort_by(|a, b| a.0.total_cmp(&b.0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(beat: f64, pad: u8) -> Event {
        Event { beat, pad, velocity: 1.0, nudge: 0.0, pitch: 0.0 }
    }

    fn collect(p: &Pattern, start: f64, span: f64) -> Vec<(f64, u8)> {
        let mut out = Vec::new();
        p.for_each_in_span(start, span, |offset, e| out.push((offset, e.pad)));
        out
    }

    #[test]
    fn unquantized_event_keeps_its_raw_position() {
        let mut p = Pattern::new(4.0);
        p.set_groove(Groove { strength: 0.0, ..Groove::default() });
        assert_eq!(p.placed_beat(&ev(1.13, 0)), 1.13);
    }

    #[test]
    fn full_strength_snaps_to_grid() {
        let mut p = Pattern::new(4.0);
        p.set_groove(Groove { strength: 1.0, ..Groove::default() });
        assert!((p.placed_beat(&ev(1.13, 0)) - 1.25).abs() < 1e-9);
    }

    #[test]
    fn half_strength_moves_halfway_to_grid() {
        let mut p = Pattern::new(4.0);
        p.set_groove(Groove { strength: 0.5, ..Groove::default() });
        assert!((p.placed_beat(&ev(1.15, 0)) - 1.2).abs() < 1e-9);
    }

    #[test]
    fn swing_delays_offbeat_grid_positions() {
        let mut p = Pattern::new(4.0);
        p.set_groove(Groove { strength: 1.0, swing: 0.75, ..Groove::default() });
        assert!((p.placed_beat(&ev(0.25, 0)) - 0.375).abs() < 1e-9);
    }

    #[test]
    fn swing_leaves_onbeat_grid_positions() {
        let mut p = Pattern::new(4.0);
        p.set_groove(Groove { strength: 1.0, swing: 0.75, ..Groove::default() });
        assert!((p.placed_beat(&ev(0.5, 0)) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn nudge_shifts_after_quantize() {
        let mut p = Pattern::new(4.0);
        p.set_groove(Groove { strength: 1.0, ..Groove::default() });
        let mut e = ev(1.0, 0);
        e.nudge = -0.02;
        assert!((p.placed_beat(&e) - 0.98).abs() < 1e-9);
    }

    #[test]
    fn placement_wraps_into_the_loop() {
        let p = Pattern::new(4.0);
        let mut e = ev(0.0, 0);
        e.nudge = -0.1;
        assert!((p.placed_beat(&e) - 3.9).abs() < 1e-9);
    }

    #[test]
    fn span_reports_offset_from_span_start() {
        let mut p = Pattern::new(4.0);
        p.push(ev(1.5, 3));
        assert_eq!(collect(&p, 1.0, 1.0), vec![(0.5, 3)]);
    }

    #[test]
    fn span_is_half_open() {
        let mut p = Pattern::new(4.0);
        p.push(ev(1.0, 1));
        p.push(ev(2.0, 2));
        assert_eq!(collect(&p, 1.0, 1.0), vec![(0.0, 1)]);
    }

    #[test]
    fn span_crossing_loop_end_includes_events_after_wrap() {
        let mut p = Pattern::new(4.0);
        p.push(ev(3.95, 1));
        p.push(ev(0.0, 2));
        p.push(ev(0.05, 3));
        p.push(ev(0.2, 4));
        let got = collect(&p, 3.9, 0.2);
        assert_eq!(got.len(), 3);
        assert!((got[0].0 - 0.05).abs() < 1e-9 && got[0].1 == 1);
        assert!((got[1].0 - 0.1).abs() < 1e-9 && got[1].1 == 2);
        assert!((got[2].0 - 0.15).abs() < 1e-9 && got[2].1 == 3);
    }

    #[test]
    fn span_reports_events_in_time_order() {
        let mut p = Pattern::new(4.0);
        p.push(ev(1.8, 2));
        p.push(ev(1.2, 1));
        p.push(ev(1.5, 3));
        let pads: Vec<u8> = collect(&p, 1.0, 1.0).into_iter().map(|(_, pad)| pad).collect();
        assert_eq!(pads, vec![1, 3, 2]);
    }
}
