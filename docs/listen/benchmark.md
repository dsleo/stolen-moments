# Listen search symbolic pilot

Source SHA-256: af6a0d9debf042c3581565bd75baad591d32e166cd2ec7298519883de614bf12
Algorithm: listen-v1

| Variant | Hits / cases | Candidate hits | False positives |
| --- | ---: | ---: | ---: |
| clean | 12/12 | 12/12 | 0 |
| transposed+7 | 12/12 | 12/12 | 0 |
| tempo×1.25 | 12/12 | 12/12 | 0 |
| one-deleted | 12/12 | 12/12 | 0 |
| one-pitch-error | 12/12 | 12/12 | 0 |
| random-negative | 0/12 | 0/12 | 0 |

Median 674 ms; p95 933 ms; max 1221 ms on darwin/arm64.

- Synthetic symbolic queries only; not held-out instrument recordings.
- This pilot does not satisfy real-audio accuracy or physical microphone gates.
