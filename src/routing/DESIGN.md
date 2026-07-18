# Routing core design

The engine uses a deterministic, time-dependent multi-label search over the
canonical ordered route patterns. A label records the current stop, arrival
time, walking, boardings, boarded route sequence, and ordered legs. Expanding a
label scans only patterns serving that stop, finds the next valid scheduled or
frequency-based departure, and creates labels at downstream stops. Explicit
snapshot transfers form the only walking edges.

This is a label-setting equivalent to round-based public-transit routing: the
boarding count is the round, and `maximumTransfers` bounds it. Labels are
dominated per stop and route sequence by arrival, walking, and boardings; each
bucket retains at most eight labels, search is capped at 50,000 expansions, and
at most 512 destination labels are collected. Final results form a Pareto set
over arrival, transfers, walking, and preference penalty, then deduplicate by
boarded route sequence and apply the query result limit.

Scheduled trips use their service-day seconds directly, including values after
24:00. Scheduled trips with frequency windows reuse their validated stop-time
offsets and calculate the next run arithmetically without enumerating every
departure. `FrequencyOnly` and `TopologyOnly` services are not timed because the
canonical variants contain no inter-stop travel durations; routing them would
require invented arrival times.

Locked transit legs are validated against route, pattern, trip, calendar, stop
order, and exact scheduled/frequency timing. Only the unlocked prefix and suffix
are searched, and the locked legs are copied unchanged into the result.
