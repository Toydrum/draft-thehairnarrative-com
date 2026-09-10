# Journal deployment summary lint correction

Date: 2026-09-10 (Central Time)

The PR safety check rejected four literal Markdown backtick pairs in the TEST
rollback summary as ShellCheck SC2016. Print the same version, source, artifact
and manifest coordinates as plain text. No deployment command, permission,
promotion guard or rendered draft payload changes.

A regression executes the actual summary step with Bash and verifies all four
coordinates, including shell-like fixture text that must remain literal.
The regression failed on the prior formatting and passed after this change.
This corrects source validation only; it does not deploy or activate TEST.
