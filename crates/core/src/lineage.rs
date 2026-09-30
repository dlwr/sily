use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub u32);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Op {
    Import { name: String, frames: usize, sample_rate: u32 },
    Chop { markers: Vec<usize> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub parent: Option<NodeId>,
    pub op: Op,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UnknownNode(pub NodeId);

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Graph {
    nodes: Vec<Node>,
}

impl Graph {
    pub fn import(&mut self, name: &str, frames: usize, sample_rate: u32) -> NodeId {
        self.push(None, Op::Import { name: name.to_string(), frames, sample_rate })
    }

    pub fn derive(&mut self, parent: NodeId, op: Op) -> Result<NodeId, UnknownNode> {
        self.get(parent).ok_or(UnknownNode(parent))?;
        Ok(self.push(Some(parent), op))
    }

    pub fn get(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(id.0 as usize)
    }

    pub fn lineage(&self, id: NodeId) -> Vec<NodeId> {
        let mut path: Vec<NodeId> =
            std::iter::successors(self.get(id), |n| n.parent.and_then(|p| self.get(p))).map(|n| n.id).collect();
        path.reverse();
        path
    }

    pub fn children(&self, id: NodeId) -> Vec<NodeId> {
        self.nodes.iter().filter(|n| n.parent == Some(id)).map(|n| n.id).collect()
    }

    fn push(&mut self, parent: Option<NodeId>, op: Op) -> NodeId {
        let id = NodeId(self.nodes.len() as u32);
        self.nodes.push(Node { id, parent, op });
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chop(markers: &[usize]) -> Op {
        Op::Chop { markers: markers.to_vec() }
    }

    #[test]
    fn imported_node_has_no_parent() {
        let mut g = Graph::default();
        let id = g.import("break.wav", 1000, 44_100);
        assert_eq!(g.get(id).unwrap().parent, None);
    }

    #[test]
    fn deriving_from_an_unknown_node_fails() {
        let mut g = Graph::default();
        assert_eq!(g.derive(NodeId(9), chop(&[0])), Err(UnknownNode(NodeId(9))));
    }

    #[test]
    fn lineage_runs_from_the_root_to_the_node() {
        let mut g = Graph::default();
        let root = g.import("break.wav", 1000, 44_100);
        let a = g.derive(root, chop(&[0, 500])).unwrap();
        let b = g.derive(a, chop(&[0, 250, 500])).unwrap();
        assert_eq!(g.lineage(b), vec![root, a, b]);
    }

    #[test]
    fn a_node_can_branch_into_several_children() {
        let mut g = Graph::default();
        let root = g.import("break.wav", 1000, 44_100);
        let a = g.derive(root, chop(&[0, 500])).unwrap();
        let b = g.derive(root, chop(&[0, 100])).unwrap();
        let c = g.derive(root, chop(&[0, 700])).unwrap();
        assert_eq!(g.children(root), vec![a, b, c]);
    }

    #[test]
    fn graph_survives_a_serde_round_trip() {
        let mut g = Graph::default();
        let root = g.import("break.wav", 1000, 44_100);
        g.derive(root, chop(&[0, 500])).unwrap();
        let json = serde_json::to_string(&g).unwrap();
        assert_eq!(serde_json::from_str::<Graph>(&json).unwrap(), g);
    }
}
