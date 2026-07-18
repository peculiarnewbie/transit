# Routing benchmark

`routing.benchmark.test.ts` generates a deterministic network with 200 stops,
20 ordered patterns, and 20 scheduled trips. It executes the same 100 fixed
queries twice, asserts byte-identical serialized results, and applies a generous
10-second combined budget.

The threshold is deliberately isolated from behavior tests. On the initial
implementation it completes in well under one second on a typical development
machine; the larger budget accommodates shared and slower CI runners while
still detecting algorithmic explosions.
