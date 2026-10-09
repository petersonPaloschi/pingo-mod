# Bounded live evaluation

The pilot compared five fixed synthetic tasks under the pre-change baseline and final-v2 plugin snapshots, once each for cold and warm sessions. All 20 task runs passed the deterministic fixture checks. Arm order was baseline first, so this is exploratory evidence only.

| Case | Baseline cold / warm (s) | Final v2 cold / warm (s) | Acceptance |
|---|---:|---:|---|
| Edit: retry default | 7.78 / 6.88 | 7.79 / 5.33 | All four runs passed |
| Debug: inclusive range | 9.43 / 4.93 | 7.96 / 4.01 | All four runs passed |
| Search: retry path | 9.10 / 4.37 | 7.17 / 4.19 | All four runs passed |
| Implementation: duration parser | 13.89 / 6.65 | 13.76 / 5.88 | All four runs passed |
| Agent: phone implementation | 19.91 / 24.20 | 17.15 / 13.30 | All four runs passed |

Claude CLI reported/list-cost totals were $1.0435756 for the 10 baseline calls and $1.0481466 for the 10 final-v2 calls; their task-only cost deltas were $0.6331596 and $0.6345004. Four unmatched final-v1 cold calls cost $0.3272142. The separate successful feasibility canary cost $0.009321. Across 25 successful CLI calls, the reported/list-cost total was $2.4282574. A failed unauthenticated canary reported $0; a CLI configuration failure stopped before a model request and had no cost field. These figures are CLI estimates, not invoices.

TypeSafe usage is incomplete: the baseline linked-input subtotal estimate was about $0.004101, while unlinked `TraceConsult` usage may be missing, especially for the Agent case. The Sift benchmark separately estimated $0.4566 for its 12 normal-mode situations and $0.0088 for a partial fast-mode sample. These are list-rate estimates, not invoices; the shared $5 ceiling cannot be certified.

The protocol calls for 15 cases and five paired repetitions per cache state; this pilot used five cases and one repetition. It did not randomize arm order or collect the blinded 0–4 rubric. The comparison changes whole source bundles. Main-model routing and effort calibration were not tested because every task used Sonnet 5.5/medium. One native `general-purpose` Agent call was observed per agent run, but the subagent model/effort and complete provider usage were not captured. No T09, T10, or T11 benefit or policy decision follows.

The baseline snapshot was commit `bde877d4f5b4f81011b6a0754022a12efe47cdc8` plus patch `66248CEE231AE037EDE9F58986B4A993AC87F196BAA40E0DDC9EEDE76EBD6989`. Final v2 used that commit plus patch `1CF6DB864C4176A5BF7B0B8D4426E7B40FE643A760658F390A4F5895C6D71EF8`. After the v2 snapshot was frozen, three unused generic-advisor translation keys per language were removed; they had no consumers and changed no runtime behavior. Results apply to the frozen v2 snapshot. Four final-v1 runs are retained in the external evidence archive and excluded from this table.
