use crate::features::Features;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Kick,
    Snare,
    Clap,
    Rim,
    ClosedHat,
    OpenHat,
    Tom,
    Cymbal,
    Perc,
    Bass,
    Keys,
    Vocal,
    Melody,
    Fx,
    Upper,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Prediction {
    pub category: Category,
    pub confidence: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Model {
    Linear(LinearModel),
    Trees(TreeModel),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LinearModel {
    pub classes: Vec<Category>,
    pub mean: Vec<f32>,
    pub scale: Vec<f32>,
    pub weights: Vec<Vec<f32>>,
    pub bias: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TreeModel {
    pub classes: Vec<Category>,
    pub baseline: Vec<f32>,
    pub trees: Vec<Tree>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tree {
    pub class: usize,
    pub feature: Vec<u16>,
    pub threshold: Vec<f32>,
    pub left: Vec<u32>,
    pub right: Vec<u32>,
    pub value: Vec<f32>,
    pub leaf: Vec<bool>,
}

impl Model {
    pub fn probabilities(&self, features: &Features) -> Vec<(Category, f32)> {
        let x = features.to_vec();
        let (classes, logits) = match self {
            Model::Linear(m) => (&m.classes, m.logits(&x)),
            Model::Trees(m) => (&m.classes, m.logits(&x)),
        };
        classes.iter().copied().zip(softmax(&logits)).collect()
    }

    pub fn predict(&self, features: &Features) -> Prediction {
        self.probabilities(features)
            .into_iter()
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(category, confidence)| Prediction { category, confidence })
            .unwrap_or(Prediction { category: Category::Perc, confidence: 0.0 })
    }
}

impl LinearModel {
    fn logits(&self, x: &[f32]) -> Vec<f32> {
        let z: Vec<f32> = x
            .iter()
            .enumerate()
            .map(|(i, v)| (v - self.mean.get(i).copied().unwrap_or(0.0)) / self.scale.get(i).copied().filter(|s| *s > 0.0).unwrap_or(1.0))
            .collect();
        self.weights.iter().zip(&self.bias).map(|(w, b)| w.iter().zip(&z).map(|(w, x)| w * x).sum::<f32>() + b).collect()
    }
}

impl TreeModel {
    fn logits(&self, x: &[f32]) -> Vec<f32> {
        let mut logits = self.baseline.clone();
        for tree in &self.trees {
            if let Some(l) = logits.get_mut(tree.class) {
                *l += tree.evaluate(x);
            }
        }
        logits
    }
}

impl Tree {
    fn evaluate(&self, x: &[f32]) -> f32 {
        let mut node = 0usize;
        while !self.leaf.get(node).copied().unwrap_or(true) {
            let v = x.get(self.feature[node] as usize).copied().unwrap_or(0.0);
            node = if v <= self.threshold[node] { self.left[node] } else { self.right[node] } as usize;
        }
        self.value.get(node).copied().unwrap_or(0.0)
    }
}

fn softmax(logits: &[f32]) -> Vec<f32> {
    let max = logits.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let exp: Vec<f32> = logits.iter().map(|l| (l - max).exp()).collect();
    let sum: f32 = exp.iter().sum();
    exp.iter().map(|e| e / sum).collect()
}

const RULE_CONFIDENCE: f32 = 0.4;

pub fn by_rules(f: &Features) -> Prediction {
    let category = if f.pitchedness > 0.8 && f.decay > 0.3 {
        if f.low > 0.5 {
            Category::Bass
        } else {
            Category::Upper
        }
    } else if f.low > 0.6 {
        Category::Kick
    } else if f.high / (f.mid + f.high + 1e-6) > 0.85 && f.high > 0.4 {
        if f.decay < 0.12 {
            Category::ClosedHat
        } else if f.decay < 0.6 {
            Category::OpenHat
        } else {
            Category::Cymbal
        }
    } else if f.flatness > 0.05 {
        Category::Snare
    } else if f.pitchedness > 0.6 {
        Category::Tom
    } else {
        Category::Perc
    };
    Prediction { category, confidence: RULE_CONFIDENCE }
}

pub fn classify(features: &Features, model: Option<&Model>) -> Prediction {
    match model {
        Some(m) => m.predict(features),
        None => by_rules(features),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::{extract, LEN};

    const SR: u32 = 44_100;

    fn tone(freq: f32, seconds: f32, decay: f32) -> Vec<f32> {
        (0..(SR as f32 * seconds) as usize)
            .map(|i| {
                let t = i as f32 / SR as f32;
                (2.0 * std::f32::consts::PI * freq * t).sin() * (-t * decay).exp() * 0.8
            })
            .collect()
    }

    fn noise(seconds: f32, decay: f32, lowpass: Option<f32>) -> Vec<f32> {
        let mut seed: u32 = 11;
        let mut y = 0.0f32;
        let a = lowpass.map(|hz| 1.0 - (-2.0 * std::f32::consts::PI * hz / SR as f32).exp());
        (0..(SR as f32 * seconds) as usize)
            .map(|i| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let x = (seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0;
                y = match a {
                    Some(a) => y + a * (x - y),
                    None => x,
                };
                y * (-(i as f32) / SR as f32 * decay).exp() * 0.8
            })
            .collect()
    }

    fn category(samples: &[f32]) -> Category {
        by_rules(&extract(samples, SR)).category
    }

    fn two_class_model() -> Model {
        let mut w0 = vec![0.0; LEN];
        let mut w1 = vec![0.0; LEN];
        w0[0] = -4.0;
        w1[0] = 4.0;
        Model::Linear(LinearModel {
            classes: vec![Category::Kick, Category::Bass],
            mean: vec![0.5; LEN],
            scale: vec![0.25; LEN],
            weights: vec![w0, w1],
            bias: vec![0.0, 0.0],
        })
    }

    #[test]
    fn model_picks_the_highest_scoring_class() {
        let short = extract(&tone(60.0, 0.2, 20.0), SR);
        let long = extract(&tone(60.0, 1.0, 1.0), SR);
        let m = two_class_model();
        assert_eq!((m.predict(&short).category, m.predict(&long).category), (Category::Kick, Category::Bass));
    }

    #[test]
    fn model_confidence_is_a_probability() {
        let p = two_class_model().predict(&extract(&tone(60.0, 0.2, 20.0), SR));
        assert!(p.confidence > 0.5 && p.confidence <= 1.0);
    }

    #[test]
    fn classify_prefers_the_model_when_given() {
        let f = extract(&tone(60.0, 1.0, 1.0), SR);
        assert_eq!(classify(&f, Some(&two_class_model())).category, Category::Bass);
    }

    #[test]
    fn rules_hear_a_short_low_thump_as_a_kick() {
        assert_eq!(category(&tone(55.0, 0.4, 12.0)), Category::Kick);
    }

    #[test]
    fn rules_hear_a_short_noise_tick_as_a_closed_hat() {
        assert_eq!(category(&noise(0.1, 60.0, None)), Category::ClosedHat);
    }

    #[test]
    fn rules_hear_a_ringing_noise_as_an_open_hat() {
        assert_eq!(category(&noise(0.5, 8.0, None)), Category::OpenHat);
    }

    #[test]
    fn rules_hear_a_dark_noise_burst_as_a_snare() {
        let mut s = noise(0.3, 18.0, Some(2_500.0));
        for (x, t) in s.iter_mut().zip(tone(190.0, 0.3, 25.0)) {
            *x += t * 0.5;
        }
        assert_eq!(category(&s), Category::Snare);
    }

    #[test]
    fn rules_hear_a_sustained_low_tone_as_bass() {
        assert_eq!(category(&tone(55.0, 1.5, 0.5)), Category::Bass);
    }

    #[test]
    fn rules_hear_a_sustained_mid_tone_as_upper() {
        assert_eq!(category(&tone(440.0, 1.5, 0.5)), Category::Upper);
    }

    #[test]
    fn rules_are_not_confident() {
        assert!(by_rules(&extract(&tone(55.0, 0.4, 12.0), SR)).confidence < 0.6);
    }

    #[test]
    fn rules_hear_a_hat_over_a_kick_tail_as_a_hat() {
        let tail: Vec<f32> = tone(60.0, 0.33, 8.0).iter().map(|x| x * 0.08).collect();
        let mut s = noise(0.33, 60.0, None);
        for (x, t) in s.iter_mut().zip(tail) {
            *x = *x * 0.3 + t;
        }
        assert_eq!(category(&s), Category::ClosedHat);
    }

    fn split_on_duration(class: usize, short: f32, long: f32) -> Tree {
        Tree {
            class,
            feature: vec![0, 0, 0],
            threshold: vec![0.5, 0.0, 0.0],
            left: vec![1, 0, 0],
            right: vec![2, 0, 0],
            value: vec![0.0, short, long],
            leaf: vec![false, true, true],
        }
    }

    fn tree_model(trees: Vec<Tree>) -> Model {
        Model::Trees(TreeModel { classes: vec![Category::Kick, Category::Bass], baseline: vec![0.0, 0.0], trees })
    }

    #[test]
    fn trees_follow_their_thresholds() {
        let m = tree_model(vec![split_on_duration(1, -2.0, 2.0)]);
        let short = extract(&tone(60.0, 0.2, 20.0), SR);
        let long = extract(&tone(60.0, 1.0, 1.0), SR);
        assert_eq!((m.predict(&short).category, m.predict(&long).category), (Category::Kick, Category::Bass));
    }

    #[test]
    fn trees_of_the_same_class_add_up() {
        let one = tree_model(vec![split_on_duration(1, 0.0, 1.0)]);
        let two = tree_model(vec![split_on_duration(1, 0.0, 1.0), split_on_duration(1, 0.0, 1.0)]);
        let long = extract(&tone(60.0, 1.0, 1.0), SR);
        assert!(two.predict(&long).confidence > one.predict(&long).confidence);
    }

    #[test]
    fn probabilities_cover_every_class_and_sum_to_one() {
        let p = tree_model(vec![split_on_duration(1, -2.0, 2.0)]).probabilities(&extract(&tone(60.0, 1.0, 1.0), SR));
        assert_eq!(p.len(), 2);
        assert!((p.iter().map(|(_, v)| v).sum::<f32>() - 1.0).abs() < 1e-5);
    }

    #[test]
    fn models_load_from_tagged_json() {
        let json = r#"{"kind":"trees","classes":["kick","bass"],"baseline":[0,0],"trees":[]}"#;
        assert!(matches!(serde_json::from_str::<Model>(json).unwrap(), Model::Trees(_)));
    }
}
