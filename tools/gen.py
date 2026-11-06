# -*- coding: utf-8 -*-
"""FOLD TWIN 关卡生成器

规则（前端必须逐字一致）：
  一次输入 = 两个角色同向各走一步（flip 关卡下界方向取反）
  · 撞墙 / 出界  -> 该角色原地不动，整步照常执行
  · 踩深渊       -> 整步作废，步数仍 +1
  · 冰面         -> 滑行，撞墙或在深渊前停下（绝不滑进深渊）
  目标：两个角色同时站在各自出口上。

双界联合状态只有 (a, b) 两对坐标，BFS 空间 <= 121*121，最优步数可精确求出。
"""
import json, random, sys
from collections import deque

FLOOR, WALL, CHASM, ICE = 0, 1, 2, 3
DIRS = [('U', 0, -1), ('D', 0, 1), ('L', -1, 0), ('R', 1, 0)]
DXY = {'U': (0, -1), 'D': (0, 1), 'L': (-1, 0), 'R': (1, 0)}
CH = {FLOOR: '.', WALL: '#', CHASM: 'x', ICE: '~'}


def advance(g, p, d):
    """单个角色朝 d 走一步（含冰面滑行）。返回 (新位置, 是否踩空)。"""
    w, h = len(g[0]), len(g)
    x, y = p
    nx, ny = x + d[0], y + d[1]
    if not (0 <= nx < w and 0 <= ny < h):
        return p, False                      # 边界：停留
    c = g[ny][nx]
    if c == WALL:
        return p, False
    if c == CHASM:
        return p, True                       # 踩空
    # 踏上这一格；若是冰面继续滑
    while True:
        x, y = nx, ny
        if g[y][x] != ICE:
            return (x, y), False
        nx, ny = x + d[0], y + d[1]
        if not (0 <= nx < w and 0 <= ny < h):
            return (x, y), False
        if g[ny][nx] in (WALL, CHASM):
            return (x, y), False             # 冰面在障碍 / 深渊前停住


def joint(ga, gb, a, b, dr, flip):
    """一次输入：返回新的 (a,b)；若任一方踩空返回 None。"""
    dx, dy = DXY[dr]
    na, dead_a = advance(ga, a, (dx, dy))
    if dead_a:
        return (None, None), True
    db = (-dx, -dy) if flip else (dx, dy)
    nb, dead_b = advance(gb, b, db)
    if dead_b:
        return (None, None), True
    return (na, nb), False


def solve(ga, gb, sa, sb, ea, eb, flip, cap=60000):
    """BFS 求最少步数与路径。"""
    start = (sa, sb)
    if sa == ea and sb == eb:
        return 0, []
    parent = {start: None}
    moveof = {}
    q = deque([start])
    while q:
        st = q.popleft()
        for dr, _, _ in DIRS:
            ns, dead = joint(ga, gb, st[0], st[1], dr, flip)
            if dead or ns in parent:
                continue
            parent[ns] = st
            moveof[ns] = dr
            if ns[0] == ea and ns[1] == eb:
                path, cur = [], ns
                while parent[cur] is not None:
                    path.append(moveof[cur])
                    cur = parent[cur]
                return len(path), list(reversed(path))
            if len(parent) > cap:
                return None, None
            q.append(ns)
    return None, None


def replay(ga, gb, sa, sb, path, flip):
    """按规则真实走一遍，返回 (a, b, 步数) 用于复核。"""
    a, b = sa, sb
    for dr in path:
        (a, b), dead = joint(ga, gb, a, b, dr, flip)
        if dead:
            return None, None, None
    return a, b, len(path)


def parse(rows):
    m = {'#': WALL, '.': FLOOR, 'x': CHASM, '~': ICE}
    return [[m[c] for c in r] for r in rows]


def dump(g):
    return [''.join(CH[c] for c in row) for row in g]


def make_grid(w, h, rng, ice_p, chasm_p, wall_p, protect):
    """随机地形，protect 中的格子强制为地面。"""
    g = [[FLOOR] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if (x, y) in protect:
                continue
            r = rng.random()
            if r < wall_p:
                g[y][x] = WALL
            elif r < wall_p + chasm_p:
                g[y][x] = CHASM
            elif r < wall_p + chasm_p + ice_p:
                g[y][x] = ICE
    return g


def smooth(g, rng, passes=2):
    """把孤立墙块并进通道，避免棋盘式噪点。"""
    h, w = len(g), len(g[0])
    for _ in range(passes):
        wall_set = {(x, y) for y in range(h) for x in range(w) if g[y][x] == WALL}
        for (x, y) in list(wall_set):
            n = 0
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if (x + dx, y + dy) in wall_set:
                    n += 1
            if n <= 1 and rng.random() < 0.72:
                g[y][x] = FLOOR
        wall_set = {(x, y) for y in range(h) for x in range(w) if g[y][x] == WALL}
        for (x, y) in list(wall_set):
            n = 0
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if (x + dx, y + dy) in wall_set:
                    n += 1
            if n >= 3 and rng.random() < 0.30:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if (x + dx, y + dy) in wall_set and rng.random() < 0.5:
                        g[y + dy][x + dx] = WALL
    return g


def free_cells(g):
    return [(x, y) for y in range(len(g)) for x in range(len(g[0])) if g[y][x] == FLOOR]


# (w, h, par_lo, par_hi, 冰面?, 反向?, 墙密度, 渊密度)
PLAN = [
    (5, 3, 4, 5, 0, 0, 0.05, 0.03), (6, 3, 4, 6, 0, 0, 0.07, 0.04),
    (6, 3, 5, 7, 0, 0, 0.09, 0.06), (6, 4, 5, 7, 0, 0, 0.10, 0.07),
    (7, 4, 6, 8, 0, 0, 0.11, 0.08), (7, 4, 6, 8, 0, 0, 0.12, 0.09),
    (8, 4, 6, 9, 0, 0, 0.13, 0.09), (8, 4, 7, 9, 0, 0, 0.14, 0.10),
    (8, 5, 7, 10, 1, 0, 0.13, 0.09), (9, 5, 7, 10, 1, 0, 0.14, 0.10),
    (9, 5, 8, 11, 1, 0, 0.15, 0.10), (10, 4, 8, 11, 1, 0, 0.15, 0.10),
    (10, 5, 8, 12, 1, 0, 0.15, 0.11), (10, 5, 9, 12, 1, 0, 0.16, 0.11),
    (11, 5, 9, 13, 1, 1, 0.15, 0.10), (11, 5, 10, 13, 1, 1, 0.16, 0.11),
    (11, 5, 10, 14, 1, 1, 0.16, 0.11), (11, 5, 10, 14, 1, 1, 0.17, 0.12),
]

NAMES = ['初折', '错位', '隙', '双径', '回廊', '窄门', '偏光', '断桥', '滑行', '浮冰',
         '逆流', '绕行', '分流', '窄缝', '反向', '镜像', '交错', '合界']


def main():
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 20261107
    rng = random.Random(seed)
    out = []
    seen = set()

    HAND = [
        {'w': 5, 'h': 3, 'par': 4, 'flip': 0, 'n': NAMES[0],
         'a': ['.....', '.....', '.....'], 'b': ['.....', '.....', '.....'],
         'sa': [0, 2], 'sb': [0, 0], 'ea': [4, 2], 'eb': [4, 0],
         'path': ['R', 'R', 'R', 'R']},
    ]

    for idx, (w, h, lo, hi, use_ice, flip, wp, cp) in enumerate(PLAN[:1], 1):
        h0 = HAND[0]
        ok, path = solve(parse(h0['a']), parse(h0['b']),
                         tuple(h0['sa']), tuple(h0['sb']), tuple(h0['ea']), tuple(h0['eb']), 0)
        assert ok == h0['par'], (ok, h0['par'])
        assert path == h0['path'], (path, h0['path'])
        h0['ice'] = 0
        h0['chasm'] = 0
        out.append(h0)
        print('L1  手工教学关 5x3 par=4  ' + ' '.join(path), flush=True)
        for y in range(3):
            print('        ' + h0['a'][y] + '      ' + h0['b'][y])
        print()

    for idx, (w, h, lo, hi, use_ice, flip, wp, cp) in enumerate(PLAN[1:], 2):
        best = None
        for attempt in range(60000):
            ice_p = (0.09 if use_ice else 0.0)
            ga = smooth(make_grid(w, h, rng, ice_p, cp, wp, set()), rng)
            gb = smooth(make_grid(w, h, rng, ice_p, cp + 0.02, wp, set()), rng)
            fa, fb = free_cells(ga), free_cells(gb)
            if len(fa) < 6 or len(fb) < 6:
                continue
            ca = sum(r.count('x') for r in dump(ga))
            cb = sum(r.count('x') for r in dump(gb))
            if idx >= 2 and (ca < 1 or cb < 1):
                continue
            sa, sb = rng.choice(fa), rng.choice(fb)
            # 从随机词构造一条必然存在的解
            word = []
            ok = True
            for _ in range(rng.randint(3, 16)):
                dr = rng.choice('UDLR')
                if word and (word[-1], dr) in (('U', 'D'), ('D', 'U'), ('L', 'R'), ('R', 'L')):
                    continue
                word.append(dr)
            if len(word) < 3:
                continue
            na, nb, _ = replay(ga, gb, sa, sb, word, flip)
            if na is None or (na == sa and nb == sb):
                continue
            if na == sa or nb == sb:
                continue                      # 任一方原地即终点 -> 该界是摆设
            ea, eb = na, nb
            if ga[ea[1]][ea[0]] != FLOOR or gb[eb[1]][eb[0]] != FLOOR:
                continue
            par, path = solve(ga, gb, sa, sb, ea, eb, flip)
            if par is None or not (lo <= par <= hi):
                continue
            # 质量：两个角色都必须真的动过
            a, b = sa, sb
            moved = [False, False]
            for dr in path:
                (na2, nb2), dead = joint(ga, gb, a, b, dr, flip)
                if dead:
                    ok = False
                    break
                if na2 != a:
                    moved[0] = True
                if nb2 != b:
                    moved[1] = True
                a, b = na2, nb2
            if not ok or not all(moved):
                continue
            # 地图指纹去重
            sig = (tuple(map(tuple, ga)), tuple(map(tuple, gb)))
            if sig in seen:
                continue
            seen.add(sig)
            best = {
                'w': w, 'h': h, 'par': par, 'flip': flip, 'n': NAMES[idx - 1],
                'a': dump(ga), 'b': dump(gb),
                'sa': list(sa), 'sb': list(sb), 'ea': list(ea), 'eb': list(eb),
                'path': path,
                'ice': sum(r.count('~') for r in dump(gb)),
                'chasm': sum(r.count('x') for r in dump(ga)) + sum(r.count('x') for r in dump(gb)),
            }
            break
        if not best:
            print('!! 生成失败', idx, (w, h, lo, hi), flush=True)
            continue
        out.append(best)
        print('L%-2d %dx%d par=%2d flip=%d 冰=%d 渊=%d  %s' % (
            idx, w, h, best['par'], flip, best['ice'], best['chasm'], ' '.join(path)), flush=True)
        print('  上界 A:        ' + '   下界 B:')
        for y in range(h):
            pa = ''.join('S' if (x, y) == tuple(best['sa']) else ('E' if (x, y) == tuple(best['ea']) else c)
                         for x, c in enumerate(best['a'][y]))
            pb = ''.join('S' if (x, y) == tuple(best['sb']) else ('E' if (x, y) == tuple(best['eb']) else c)
                         for x, c in enumerate(best['b'][y]))
            print('        ' + pa + '      ' + pb)
        print()

    audit(out)
    json.dump(out, open('tools/levels.json', 'w'), ensure_ascii=False, indent=0)
    print('total', len(out), 'pars', [o['par'] for o in out])


def audit(levels):
    """写盘前自检：任何一条不成立就直接抛错，不让坏数据进 levels.json。"""
    bad = []
    for i, lv in enumerate(levels, 1):
        ga, gb = parse(lv['a']), parse(lv['b'])
        # 1) 起点与出口必须是地面：压墙走不进去，压渊永远踩空
        for g, tag, pts in ((ga, 'A', (lv['sa'], lv['ea'])), (gb, 'B', (lv['sb'], lv['eb']))):
            for name, (x, y) in zip(('起点', '出口'), pts):
                if g[y][x] != FLOOR:
                    bad.append('L%d %s %s 落在 %s 上' % (i, tag, name, CH[g[y][x]]))
        # 2) 出口不能与起点重合：否则该角色零步通关，这一界等于摆设
        if tuple(lv['sa']) == tuple(lv['ea']):
            bad.append('L%d 上界出口与起点重合' % i)
        if tuple(lv['sb']) == tuple(lv['eb']):
            bad.append('L%d 下界出口与起点重合' % i)
        # 3) 标准解必须真能走通，且最后一格正好落在两个出口上
        a, b, n = replay(ga, gb, tuple(lv['sa']), tuple(lv['sb']), lv['path'], lv['flip'])
        if a is None:
            bad.append('L%d 标准解踩空作废' % i)
        else:
            if tuple(a) != tuple(lv['ea']) or tuple(b) != tuple(lv['eb']):
                bad.append('L%d 标准解终点 %s/%s 与出口不符' % (i, a, b))
            if n != lv['par']:
                bad.append('L%d 步数 %d != par %d' % (i, n, lv['par']))
        # 4) 前 14 关不应出现反向，否则难度曲线断层
        if lv['flip'] and i < 15:
            bad.append('L%d 过早开启反向' % i)
    if bad:
        raise SystemExit('自检失败:\n  ' + '\n  '.join(bad))
    print('自检通过：%d 关，起点/出口合法、标准解可走通、步数=par、反向曲线正常' % len(levels))


if __name__ == '__main__':
    main()
