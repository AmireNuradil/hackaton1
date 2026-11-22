"""Exercise a running Afterimage build in a fresh Chromium context."""

import argparse
import json
import shutil
import tempfile
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import quote
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / 'public' / 'memories'
TITLE = 'Последний автобус под дождём'
STORY = f'{TITLE}. Капли стекали по стеклу. На пустом сиденье напротив дрожал тёплый свет.'


@contextmanager
def static_server(directory):
    handler = partial(SimpleHTTPRequestHandler, directory=directory)
    with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f'http://127.0.0.1:{server.server_port}'
        finally:
            server.shutdown()
            thread.join()


def create_bus_day(page, track=None):
    page.get_by_role('button', name='New memory').click()
    page.get_by_label('What happened?').fill(STORY)
    page.locator('#entry-photos').set_input_files(ROOT / 'arttech-handoff' / 'assets' / 'last-bus.webp')
    if track:
        page.locator('#entry-audio').set_input_files(MEDIA / track)
    else:
        page.get_by_role('radio', name='Song link').check()
        page.get_by_label('Song URL').fill('https://example.com/team-song')
        page.get_by_label('Pace', exact=True).select_option('62')
        page.get_by_label('Energy', exact=True).select_option('0.25')
    page.get_by_role('button', name='Create memory').click()
    expect(page.locator('#viewer-title')).to_have_text(TITLE)
    page.get_by_text('How this memory was made').click()
    return page.locator('#memory-recipe dd').last.inner_text()


def check_export(page, context):
    with page.expect_download() as transfer:
        page.get_by_role('button', name='Download day').click()
    with tempfile.TemporaryDirectory(prefix='afterimage-day-') as directory:
        with ZipFile(transfer.value.path()) as archive:
            player = next(name for name in archive.namelist() if name.endswith('/memory.html'))
            folder = player.rsplit('/', 1)[0]
            expected = {f'{folder}/{name}' for name in ('entry.txt', 'day.json', 'memory.html', 'photo-01.webp', 'soundtrack.mp3')}
            assert set(archive.namelist()) == expected
            assert '..' not in Path(folder).parts and not Path(folder).is_absolute()
            assert archive.testzip() is None
            day = json.loads(archive.read(f'{folder}/day.json'))
            assert day['title'] == TITLE and day['soundtrack'] == 'soundtrack.mp3'
            assert day['analysis']['music']['bpm'] in range(128, 137)
            archive.extractall(directory)
        with static_server(directory) as host:
            standalone = context.new_page()
            standalone.goto(f'{host}/{quote(player)}')
            standalone.get_by_role('button', name='Play memory').click()
            standalone.wait_for_function('!document.getElementById("song").paused')
            standalone.close()


def smoke_test(browser, base_url):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base_url)
    expect(page.locator('.entry')).to_have_count(6)

    fast = create_bus_day(page, 'city.mp3')
    page.locator('#play-scene').click()
    page.wait_for_function('!document.getElementById("soundtrack").paused')
    page.get_by_role('button', name='Mute').click()
    assert page.locator('#soundtrack').evaluate('(audio) => audio.muted')
    check_export(page, context)
    page.get_by_role('button', name='Close memory').click()

    slow = create_bus_day(page, 'coast.mp3')
    assert fast != slow, (fast, slow)
    page.get_by_role('button', name='Close memory').click()

    described = create_bus_day(page)
    expect(page.get_by_role('link', name='Open song')).to_have_attribute('href', 'https://example.com/team-song')
    expect(page.locator('#memory-recipe')).to_contain_text('about 62 BPM')
    assert described != fast
    page.get_by_role('button', name='Close memory').click()

    page.reload()
    page.get_by_label('Filter memories').select_option('mine')
    expect(page.locator('.entry')).to_have_count(3)
    page.locator('.entry').first.click()
    expect(page.locator('#viewer-title')).to_have_text(TITLE)
    assert not errors, errors
    context.close()

    mobile = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    mobile.goto(base_url)
    expect(mobile.locator('.entry')).to_have_count(6)
    assert mobile.evaluate('document.documentElement.scrollWidth') == 390
    mobile.get_by_role('button', name='New memory').click()
    expect(mobile.locator('#editor')).to_be_visible()
    mobile.close()
    print(f'Browser checks passed. Same words and photo, city {fast} versus coast {slow}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4173/')
    parser.add_argument('--chromium', default=shutil.which('chromium'))
    options = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=options.chromium)
        try:
            smoke_test(browser, options.url)
        finally:
            browser.close()


if __name__ == '__main__':
    main()
