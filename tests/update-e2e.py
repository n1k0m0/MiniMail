"""Run the real Docker lifecycle test with a private interactive admin prompt."""
import os
import pty
import select
import subprocess
import sys
import time

master, slave = pty.openpty()
process = subprocess.Popen(sys.argv[1:] or ["./update-e2e.test", "-test.v", "-test.run", "^TestDockerLifecycle$"], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
pending = b""
answered = set()
deadline = time.monotonic() + 900
try:
    while process.poll() is None:
        if time.monotonic() > deadline:
            process.kill()
            raise RuntimeError("Docker lifecycle test exceeded its deadline")
        readable, _, _ = select.select([master], [], [], 1)
        if not readable:
            continue
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        pending = (pending + chunk)[-8192:]
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
        for prompt in [b"Admin-Passwort (mindestens 12 Zeichen):", b"Passwort wiederholen:"]:
            if prompt in pending and prompt not in answered:
                os.write(master, b"synthetic-release-test-password\r")
                answered.add(prompt)
    sys.exit(process.wait())
finally:
    os.close(master)
    if process.poll() is None:
        process.kill()
