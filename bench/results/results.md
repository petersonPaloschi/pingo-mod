# Sift benchmark result

The Claude-alone values below are stored Quicksilver references. They were not rerun as paired sessions with Sift, so this table does not claim total task savings or a causal speed-up. Sift context counts are character-based estimates; Jev usage and the configured TypeSafe input list-rate estimate are reported separately. The rate estimate is not an invoice.

| # | Situation | Metric | Stored baseline quality | Sift quality | Sift CLI wall | Jev input usage | TypeSafe input list-rate estimate | Sift context estimate |
|---|---|---|---:|---:|---:|---:|---:|---:|
| 01 | Real log triage | F1 | 54% | 23% | 150.6s | 774.6k | ~$0.0325 | ~12.6k tok (estimate) |
| 02 | Needles in a noisy service log | F1 | 100% | 100% | 227.7s | 1038.5k | ~$0.0436 | ~2.6k tok (estimate) |
| 03 | Support ticket routing | accuracy | 100% | 99% | 15.3s | 76.2k | ~$0.0032 | ~2.7k tok (estimate) |
| 04 | Spam filtering | F1 | 97% | 92% | 22.3s | 98.9k | ~$0.0042 | ~4.3k tok (estimate) |
| 05 | Review sentiment | accuracy | 97% | 96% | 15.4s | 66.7k | ~$0.0028 | ~3.0k tok (estimate) |
| 06 | Codebase discovery | F1 | 100% | 100% | 14.6s | 302.5k | ~$0.0127 | ~3.8k tok (estimate) |
| 07 | Security review shortlist | F1 | 100% | 89% | 3.3s | 13.6k | ~$0.0006 | ~2.7k tok (estimate) |
| 08 | CI failure triage | accuracy | 100% | 100% | 6.2s | 35.4k | ~$0.0015 | ~2.5k tok (estimate) |
| 09 | Semantic search in a huge file | hit@5 | 100% | 100% | 92.4s | 5068.9k | ~$0.2129 | ~4.2k tok (estimate) |
| 10 | Relevance ranking | hit@3 | 100% | 100% | 148.1s | 3247.8k | ~$0.1364 | ~16.7k tok (estimate) |
| 11 | Commit classification | accuracy | 83% | 74% | 13.9s | 78.8k | ~$0.0033 | ~3.2k tok (estimate) |
| 12 | Numeric threshold stress test | F1 | 100% | 100% | 15.2s | 68.5k | ~$0.0029 | ~2.4k tok (estimate) |

**12 situations:** Sift CLI wall 725.0s; Jev usage 10870.3k reported; TypeSafe input list-rate estimate ~$0.4566. This estimate is not a provider invoice or whole-task cost. Quality is reported per task because these metrics have different definitions and sample sizes.
