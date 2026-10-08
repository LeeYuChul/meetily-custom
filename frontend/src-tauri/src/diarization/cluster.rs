//! Agglomerative clustering of speaker embeddings.
//!
//! Average linkage on cosine distance, computed with the nearest-neighbor-chain
//! algorithm (O(n²) time and memory), then cut by distance threshold. Small
//! clusters (usually noise, laughter, crosstalk) are folded into the closest
//! large cluster, and an optional target speaker count is enforced afterwards.

/// Cosine distance threshold for the dendrogram cut (calibrated on CAM++ 1.5s windows).
pub const DEFAULT_THRESHOLD: f32 = 0.7;

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Returns merges as (slot_a, slot_b, distance); slot_a survives each merge.
fn nn_chain_average_linkage(embeddings: &[Vec<f32>]) -> Vec<(usize, usize, f32)> {
    let n = embeddings.len();
    let mut dist = vec![0.0f32; n * n];
    for i in 0..n {
        for j in (i + 1)..n {
            let d = 1.0 - dot(&embeddings[i], &embeddings[j]);
            dist[i * n + j] = d;
            dist[j * n + i] = d;
        }
    }

    let mut size = vec![1usize; n];
    let mut active = vec![true; n];
    let mut active_count = n;
    let mut chain: Vec<usize> = Vec::with_capacity(n);
    let mut merges = Vec::with_capacity(n.saturating_sub(1));

    while active_count > 1 {
        if chain.is_empty() {
            chain.push(active.iter().position(|&a| a).unwrap());
        }
        loop {
            let a = *chain.last().unwrap();
            let prev = if chain.len() >= 2 { Some(chain[chain.len() - 2]) } else { None };
            let (mut best, mut best_d) = match prev {
                Some(p) => (p, dist[a * n + p]),
                None => (usize::MAX, f32::INFINITY),
            };
            for c in 0..n {
                if c != a && active[c] && dist[a * n + c] < best_d {
                    best = c;
                    best_d = dist[a * n + c];
                }
            }
            if Some(best) == prev {
                break;
            }
            chain.push(best);
        }

        let b = chain.pop().unwrap();
        let a = chain.pop().unwrap();
        let (a, b) = (a.min(b), a.max(b));
        merges.push((a, b, dist[a * n + b]));

        let (sa, sb) = (size[a] as f32, size[b] as f32);
        for c in 0..n {
            if active[c] && c != a && c != b {
                let d = (sa * dist[a * n + c] + sb * dist[b * n + c]) / (sa + sb);
                dist[a * n + c] = d;
                dist[c * n + a] = d;
            }
        }
        size[a] += size[b];
        active[b] = false;
        active_count -= 1;
    }

    merges
}

fn find(parent: &mut [usize], mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    x
}

/// Cluster L2-normalized embeddings. Returns a dense label per embedding (0..k).
pub fn cluster_embeddings(
    embeddings: &[Vec<f32>],
    threshold: f32,
    num_speakers: Option<usize>,
) -> Vec<usize> {
    let n = embeddings.len();
    if n == 0 {
        return Vec::new();
    }
    if n == 1 || num_speakers == Some(1) {
        return vec![0; n];
    }

    // 1. Dendrogram cut at the distance threshold
    let mut merges = nn_chain_average_linkage(embeddings);
    merges.sort_by(|x, y| x.2.partial_cmp(&y.2).unwrap_or(std::cmp::Ordering::Equal));
    let mut parent: Vec<usize> = (0..n).collect();
    for &(a, b, d) in &merges {
        if d > threshold {
            break;
        }
        let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
        if ra != rb {
            parent[rb] = ra;
        }
    }

    // 2. Collect clusters with their embedding sums
    let dim = embeddings[0].len();
    let mut roots: Vec<usize> = Vec::new();
    let mut members: Vec<Vec<usize>> = Vec::new();
    for i in 0..n {
        let r = find(&mut parent, i);
        match roots.iter().position(|&x| x == r) {
            Some(k) => members[k].push(i),
            None => {
                roots.push(r);
                members.push(vec![i]);
            }
        }
    }
    let sum_of = |ids: &[usize]| {
        let mut s = vec![0.0f32; dim];
        for &i in ids {
            for (acc, v) in s.iter_mut().zip(&embeddings[i]) {
                *acc += v;
            }
        }
        s
    };
    let mut clusters: Vec<(Vec<usize>, Vec<f32>)> =
        members.into_iter().map(|m| { let s = sum_of(&m); (m, s) }).collect();

    // Average-linkage similarity between clusters == dot(sumA, sumB) / (nA * nB)
    let similarity = |a: &(Vec<usize>, Vec<f32>), b: &(Vec<usize>, Vec<f32>)| {
        dot(&a.1, &b.1) / (a.0.len() * b.0.len()) as f32
    };

    // 3. Fold small clusters into the most similar large one
    let min_size = ((n as f32 * 0.01).ceil() as usize).max(3);
    clusters.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    let large_count = clusters.iter().filter(|c| c.0.len() >= min_size).count().max(1);
    let small: Vec<_> = clusters.split_off(large_count);
    for s in small {
        let target = (0..clusters.len())
            .max_by(|&i, &j| {
                similarity(&clusters[i], &s)
                    .partial_cmp(&similarity(&clusters[j], &s))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap();
        clusters[target].0.extend(s.0);
        for (acc, v) in clusters[target].1.iter_mut().zip(&s.1) {
            *acc += v;
        }
    }

    // 4. Enforce the requested speaker count (only merges; never splits)
    if let Some(k) = num_speakers {
        while clusters.len() > k.max(1) {
            let mut best = (0, 1, f32::NEG_INFINITY);
            for i in 0..clusters.len() {
                for j in (i + 1)..clusters.len() {
                    let s = similarity(&clusters[i], &clusters[j]);
                    if s > best.2 {
                        best = (i, j, s);
                    }
                }
            }
            let (ids, sum) = clusters.remove(best.1);
            clusters[best.0].0.extend(ids);
            for (acc, v) in clusters[best.0].1.iter_mut().zip(&sum) {
                *acc += v;
            }
        }
    }

    let mut labels = vec![0usize; n];
    for (label, (ids, _)) in clusters.iter().enumerate() {
        for &i in ids {
            labels[i] = label;
        }
    }
    labels
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(v: &[f32]) -> Vec<f32> {
        let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        v.iter().map(|x| x / n).collect()
    }

    fn two_groups() -> Vec<Vec<f32>> {
        let mut e = Vec::new();
        for i in 0..10 {
            e.push(unit(&[1.0, 0.05 * i as f32, 0.0]));
        }
        for i in 0..8 {
            e.push(unit(&[0.0, 0.05 * i as f32, 1.0]));
        }
        e
    }

    #[test]
    fn separates_distinct_groups() {
        let labels = cluster_embeddings(&two_groups(), DEFAULT_THRESHOLD, None);
        assert!(labels[..10].iter().all(|&l| l == labels[0]));
        assert!(labels[10..].iter().all(|&l| l == labels[10]));
        assert_ne!(labels[0], labels[10]);
    }

    #[test]
    fn respects_requested_speaker_count() {
        let labels = cluster_embeddings(&two_groups(), DEFAULT_THRESHOLD, Some(1));
        assert!(labels.iter().all(|&l| l == 0));
    }

    #[test]
    fn folds_tiny_outlier_cluster() {
        let mut e = two_groups();
        e.push(unit(&[0.0, 1.0, 0.0]));
        let labels = cluster_embeddings(&e, DEFAULT_THRESHOLD, None);
        let distinct: std::collections::HashSet<_> = labels.iter().collect();
        assert_eq!(distinct.len(), 2);
    }
}
