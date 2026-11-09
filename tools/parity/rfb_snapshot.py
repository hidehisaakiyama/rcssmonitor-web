#!/usr/bin/env python3
"""Save one screenshot of a VNC server as PNG (RFB 3.8, no auth, raw encoding).

Usage:
    python3 -I tools/parity/rfb_snapshot.py HOST PORT OUT.png [KEYS]

KEYS is an optional comma-separated list of keys to press first, e.g.
"Right*150,3,v,ctrl+f": a key name (a letter, a digit, minus, Right, Left,
Home, End), optionally with "ctrl+" and a repeat count "*N".

Used to capture rcssmonitor running on Qt's "vnc" platform plugin without a
display, so that its drawing can be compared with rcssmonitor-web
(see tools/parity/README.md).
"""

import socket
import struct
import sys
import time
import zlib

KEYSYMS = {'Right': 0xff53, 'Left': 0xff51, 'Home': 0xff50, 'End': 0xff57,
           'minus': 0x2d, 'ctrl': 0xffe3}


def keysym(name):
    if name in KEYSYMS:
        return KEYSYMS[name]
    if len(name) == 1:
        return ord(name)
    raise ValueError(f'unknown key {name!r}')


def press_keys(sock, spec):
    """Sends the key presses of a KEYS specification."""
    for token in filter(None, spec.split(',')):
        repeat = 1
        if '*' in token:
            token, n = token.split('*')
            repeat = int(n)
        mods = token.split('+')[:-1]
        key = keysym(token.split('+')[-1])
        for _ in range(repeat):
            for m in mods:
                sock.sendall(struct.pack('>BBxxI', 4, 1, keysym(m)))
            sock.sendall(struct.pack('>BBxxI', 4, 1, key))
            sock.sendall(struct.pack('>BBxxI', 4, 0, key))
            for m in reversed(mods):
                sock.sendall(struct.pack('>BBxxI', 4, 0, keysym(m)))
            time.sleep(0.02)
    time.sleep(1.0)  # let the application repaint


def recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError('connection closed')
        buf += chunk
    return bytes(buf)


def snapshot(host, port, keys=''):
    sock = socket.create_connection((host, port), timeout=10)
    version = recv_exact(sock, 12)
    if not version.startswith(b'RFB '):
        raise ValueError(f'not an RFB server: {version!r}')
    if version < b'RFB 003.007\n':
        # RFB 3.3 (Qt's VNC server): the server picks the security type.
        sock.sendall(b'RFB 003.003\n')
        (sec,) = struct.unpack('>I', recv_exact(sock, 4))
        if sec != 1:
            raise ValueError(f'unsupported security type {sec}')
    else:
        sock.sendall(b'RFB 003.008\n')
        n_types = recv_exact(sock, 1)[0]
        if n_types == 0:
            reason = recv_exact(sock, struct.unpack('>I', recv_exact(sock, 4))[0])
            raise ValueError(f'server refused: {reason!r}')
        types = recv_exact(sock, n_types)
        if 1 not in types:
            raise ValueError(f'no "None" security type: {list(types)}')
        sock.sendall(b'\x01')
        if struct.unpack('>I', recv_exact(sock, 4))[0] != 0:
            raise ValueError('security handshake failed')
    sock.sendall(b'\x01')  # shared session

    width, height = struct.unpack('>HH', recv_exact(sock, 4))
    recv_exact(sock, 16)  # server pixel format
    recv_exact(sock, struct.unpack('>I', recv_exact(sock, 4))[0])  # desktop name

    # 32 bpp, depth 24, little endian, true color, red at bit 16.
    pixel_format = struct.pack('>BBBBHHHBBB3x', 32, 24, 0, 1, 255, 255, 255, 16, 8, 0)
    sock.sendall(b'\x00\x00\x00\x00' + pixel_format)
    sock.sendall(struct.pack('>BxHi', 2, 1, 0))  # SetEncodings: raw
    if keys:
        press_keys(sock, keys)
    sock.sendall(struct.pack('>BBHHHH', 3, 0, 0, 0, width, height))

    fb = bytearray(width * height * 4)
    while True:
        msg = recv_exact(sock, 1)[0]
        if msg == 0:  # FramebufferUpdate
            recv_exact(sock, 1)
            (n_rects,) = struct.unpack('>H', recv_exact(sock, 2))
            for _ in range(n_rects):
                x, y, w, h, enc = struct.unpack('>HHHHi', recv_exact(sock, 12))
                if enc != 0:
                    raise ValueError(f'unexpected encoding {enc}')
                data = recv_exact(sock, w * h * 4)
                for row in range(h):
                    start = ((y + row) * width + x) * 4
                    fb[start:start + w * 4] = data[row * w * 4:(row + 1) * w * 4]
            break
        if msg == 1:  # SetColourMapEntries
            _, _, n = struct.unpack('>BHH', recv_exact(sock, 5))
            recv_exact(sock, n * 6)
        elif msg == 2:  # Bell
            pass
        elif msg == 3:  # ServerCutText
            recv_exact(sock, 3)
            recv_exact(sock, struct.unpack('>I', recv_exact(sock, 4))[0])
        else:
            raise ValueError(f'unexpected server message {msg}')
    sock.close()
    return width, height, fb


def write_png(path, width, height, bgrx):
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        row = bgrx[y * width * 4:(y + 1) * width * 4]
        for x in range(width):
            b, g, r = row[x * 4], row[x * 4 + 1], row[x * 4 + 2]
            raw += bytes((r, g, b))

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def main():
    if len(sys.argv) not in (4, 5):
        print(__doc__)
        sys.exit(1)
    host, port, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    keys = sys.argv[4] if len(sys.argv) == 5 else ''
    width, height, fb = snapshot(host, port, keys)
    write_png(out, width, height, fb)
    print(f'{out}: {width}x{height}')


if __name__ == '__main__':
    main()
