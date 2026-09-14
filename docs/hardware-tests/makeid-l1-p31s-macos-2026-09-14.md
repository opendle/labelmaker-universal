# MakeID L1 and P31S BLE checks, 2026-09-14

These checks used the macOS BLE transport and the shared TypeScript adapter.
The user permitted short prints with no added inter-label gap.

| Printer    | Reported profile | Firmware                      | Raster                                        |
| ---------- | ---------------- | ----------------------------- | --------------------------------------------- |
| L1 300 dpi | `l1-ff00-300`    | V1.08HH                       | 144 pixels across the head                    |
| P31S       | `p31-abf0-288`   | Not identified; protocol 1.20 | 288 pixels across the head, 56 rows per frame |

The L1 identified itself as `L1-300`. Its default head size is 12.2 mm, with
1.9 mm top and bottom margins. A 12-row image at Medium density completed
with the expected acknowledgements. Its raster feed length was 1.016 mm, but
the user saw no output. A second Medium test used 118 rows (9.991 mm). The
user confirmed a faint line and rectangle. The test strokes were one pixel wide.
A High-density test then used 118 rows with four-pixel strokes for an H and a
border. It completed with the expected acknowledgements. The user then
reported that the label was not correctly fitted and requested a repeat.
The same High test completed again. The user confirmed the H, but the end of
the frame remained behind the cutter. A further High test used the same
118-row image with 11 mm of blank feed appended by the shared raster helper.
This completed with the expected acknowledgements. Total L1 raster feed,
including that final feed, was about 52 mm. The application added no gap
between labels.

The P31S reported start alignment and pair-swapped raster bytes. Before the
buffer-wait correction, a 12-row image and a 57-row image completed. After the
correction, another 57-row image completed with two frames (56 rows and 1 row).
No frame rejection occurred during these checks. Total P31S raster feed was
about 11.1 mm. The application added no gap. Mechanical feed was not measured.

The first test pattern had a small central box and two side marks. The user
confirmed a small line and rectangle on the P31S. Visual confirmation of the
final feed test is pending. The original P31S failure was not
reproduced. Fake-transport tests cover a full buffer, status polling, resend
flags during polling, timeout, and session cleanup after error.

All three L1 density values have fixed protocol tests based on static inspection
of MakeID-Life 1.9.9. Medium and High were physically tested. Low was not
physically tested. No iPad, Android, Windows, or Linux hardware print was run
in this check. The E1 was not found in the nearby scan.
