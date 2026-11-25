import subprocess, sys
result = subprocess.run([
    sys.executable, '-m', 'pytest', 'tests/unit/test_a8_deliverer_and_e2e.py', '-vv'
], cwd='c:\\Users\\tamil\\OneDrive\\Documents\\projects\\autonomous-ci-repair-platform', capture_output=True, text=True, timeout=120)
print('STDOUT:')
print(result.stdout[-8000:] if len(result.stdout) > 8000 else result.stdout)
print('STDERR:')
print(result.stderr[-8000:] if len(result.stderr) > 8000 else result.stderr)
print('Return code:', result.returncode)