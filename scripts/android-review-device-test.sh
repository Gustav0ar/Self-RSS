#!/usr/bin/env bash
# Runs against fake adb/aapt/Gradle executables, never an Android device.
set -euo pipefail
review_scripts="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python3 - "$review_scripts" <<'PY'
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory(prefix='android-review-guards-') as temp:
    root = Path(temp)
    scripts = root / 'scripts'
    scripts.mkdir()
    for name in ('common', 'device', 'process', 'benchmark'):
        shutil.copyfile(Path(sys.argv[1]) / f'android-review-{name}.sh', scripts / f'android-review-{name}.sh')
    log = root / 'calls'
    def executable(name, content):
        path = root / name
        path.write_text('#!/usr/bin/env bash\nset -eu\n' + content)
        path.chmod(0o755)
        return str(path)
    adb = executable('adb', 'if [[ "$1" == devices ]]; then printf "List of devices attached\\n%s\\n" "$INVENTORY"; else printf "%s\\n" "${QEMU:-0}"; fi\n')
    gradle = executable('gradle', 'printf "%s\\n" "$*" >> "$CALL_LOG"\n')
    aapt = executable('aapt', '''case "$3" in
      *androidTest*) package=com.selffeed.android.devicetest.test ;;
      *macrobenchmark*) package=com.selffeed.android.macrobenchmark ;;
      *benchmarkPerformanceTest*) package=com.selffeed.android.performancetest ;;
      *) package=com.selffeed.android.devicetest ;;
    esac
    printf "package: name='%s' versionCode='1'\\n" "${PACKAGE_OVERRIDE:-$package}"
''')
    for path in (
        'app/build/outputs/apk/deviceTest/app-deviceTest.apk',
        'app/build/outputs/apk/androidTest/deviceTest/app-deviceTest-androidTest.apk',
        'app/build/outputs/apk/benchmarkPerformanceTest/app-benchmarkPerformanceTest.apk',
        'macrobenchmark/build/outputs/apk/benchmarkPerformanceTest/macrobenchmark-benchmarkPerformanceTest.apk',
    ):
        apk = root / 'packages/android' / path
        apk.parent.mkdir(parents=True, exist_ok=True)
        apk.touch()
    base = dict(os.environ, ANDROID_REVIEW_ADB=adb, ANDROID_REVIEW_AAPT=aapt,
                ANDROID_REVIEW_GRADLE=gradle, ANDROID_REVIEW_SERIAL='review-123',
                INVENTORY='review-123 device product:fixture', CALL_LOG=str(log))
    def run(script, args, changes, succeeds=False, no_build=False):
        log.write_text('')
        result = subprocess.run(['bash', str(scripts / f'android-review-{script}.sh'), *args],
                                env=base | changes, capture_output=True, text=True)
        assert (result.returncode == 0) == succeeds, (script, result.stderr)
        calls = log.read_text()
        if not succeeds:
            assert 'connected' not in calls, calls
        if no_build:
            assert not calls, calls
        return calls
    ui = ['com.selffeed.android.ui.ExampleTest']
    external = ['com.selffeed.android.macrobenchmark.ExampleTest']
    benchmark = ['--output', str(root / 'results')]
    for script, args in [('device', ui), ('process', external), ('benchmark', benchmark)]:
        for changes in [{'ANDROID_REVIEW_SERIAL':''}, {'INVENTORY':''},
                        {'INVENTORY':'other device'}, {'INVENTORY':'review-123 unauthorized'},
                        {'INVENTORY':'review-123 device\nother offline'}]:
            run(script, args, changes, no_build=True)
        run(script, args, {'PACKAGE_OVERRIDE':'com.selffeed.android'})
    run('device', ['invalid;class'], {}, no_build=True)
    run('process', ui, {}, no_build=True)
    run('benchmark', benchmark, {'QEMU':'1'}, no_build=True)
    for args in [ui, [ui[0] + ',com.selffeed.android.ui.SecondTest']]:
        calls = run('device', args, {}, succeeds=True)
        assert 'connectedNonDisruptiveDeviceTest' in calls and args[0] in calls
        assert 'android.injected.device.serial=review-123' in calls
    calls = run('process', external, {}, succeeds=True)
    assert 'connectedBenchmarkPerformanceTestAndroidTest' in calls
    print('Android review guards passed: missing/ambiguous/unauthorized targets, package isolation, class filters, external runner and physical-only benchmark.')
PY
