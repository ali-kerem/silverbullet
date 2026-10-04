"""Validate the portable custom server before publishing an artifact."""
import pathlib
import subprocess
import sys

binary = pathlib.Path(sys.argv[1])
data = binary.read_bytes()[:20]
assert data[:4] == b"\x7fELF" and data[4:6] == b"\x02\x01", "Expected 64-bit little-endian ELF"
assert int.from_bytes(data[18:20], "little") == 62, "Expected x86-64"
headers = subprocess.check_output(["readelf", "-l", str(binary)], text=True)
dynamic = subprocess.check_output(["readelf", "-d", str(binary)], text=True)
assert "INTERP" not in headers and "(NEEDED)" not in dynamic, "Binary must be static"
print("Verified static Linux x86-64 executable")
