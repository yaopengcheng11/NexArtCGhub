# hip_path_doctor.py — CLI entry point for "HIP Path Doctor" web tool
#
# Run by hython.exe (Houdini 22.0.368 bundled Python).
# Reads an input .hip, applies one of 4 path-fix features over the entire hip,
# saves to output .hip. Always operates on the whole hip (no per-node target).
#
# CLI:
#   hython.exe hip_path_doctor.py <input.hip> <output.hip> --feature <0|1|2|3> [args...]
#
#   --feature 0  switch_slash        no extra args
#   --feature 1  replace             --old <s> --new <s>
#   --feature 2  find_missing        no extra args
#   --feature 3  switch_abs_rel      --direction <0|1> --base <0|1|2> [--custom-base <s>]
#
# Output:
#   stdout: JSON summary (one line) with keys: feature, parms_changed, output_hip
#   stderr: human-readable result (parm list, etc.)
#   exit:   0 ok, 1 error

import argparse
import json
import os
import re
import sys
from datetime import datetime

import hou


# Feature display names — used by the embedded audit log node
FEATURE_NAMES = {
    0: 'Switch Slash',
    1: 'Replace Path',
    2: 'Find Missing',
    3: 'Switch Abs / Rel',
}


# ============================================================================
# Helpers (lifted from yaopc::FolderPathFixed 2.0 — same semantics)
# ============================================================================

def _normalize_path(p):
    r"""Convert \ to /, collapse repeated slashes, strip trailing /."""
    if not p or not isinstance(p, str):
        return p
    s = p.replace('\\', '/')
    s = re.sub(r'/+', '/', s)
    if len(s) > 1 and s.endswith('/'):
        s = s.rstrip('/')
    return s


def _expand(p):
    """Expand $HIP/$JOB/~/.. in a path. Returns '' if expansion fails."""
    if not p:
        return p
    if '$' not in p and '~' not in p:
        return p
    try:
        result = hou.text.expandString(p)
        if '$' in result and re.search(r'\$\w+', result):
            # Var still present after expand — var not set, leave as-is
            return p
        return result
    except Exception:
        return ''


def _is_file_node(n):
    tname = n.type().name().lower()
    if tname in ('file', 'filecache', 'baketexture', 'cop2net', 'arnold_image',
                 'redshift_tex', 'rsl_displacement'):
        return True
    # Generic: check if node has a file-reference parm
    for p in n.parms():
        try:
            pt = p.parmTemplate()
            if pt.type() == hou.parmTemplateType.String:
                if pt.stringType() == hou.stringParmType.FileReference:
                    return True
        except Exception:
            pass
    return False


def _get_file_parm(n):
    """Get the file-path parm for file/filecache node."""
    tname = n.type().name()
    pname = 'file' if tname == 'file' else 'sopoutput' if tname == 'filecache' else 'file'
    fp = n.parm(pname)
    if fp is not None:
        return fp
    for p in n.parms():
        try:
            pt = p.parmTemplate()
            if pt.type() == hou.parmTemplateType.String:
                if pt.stringType() == hou.stringParmType.FileReference:
                    return p
        except Exception:
            pass
    return None


def _is_absolute(p):
    if not p:
        return False
    if p.startswith('/') or p.startswith('\\'):
        return True
    if len(p) >= 3 and p[1] == ':' and p[2] in ('/', '\\'):
        return True
    return False


def _walk_all(root):
    """Yield every node under root (recursive)."""
    if root is None:
        return
    yield root
    for child in root.children():
        for n in _walk_all(child):
            yield n


def _all_string_parms(node, only_file=False, recursive=True):
    """Yield (parm, raw_value) tuples."""
    if node is None:
        return
    nodes = _walk_all(node) if recursive else [node]
    for n in nodes:
        if only_file and not _is_file_node(n):
            continue
        for p in n.parms():
            try:
                pt = p.parmTemplate()
                if pt.type() != hou.parmTemplateType.String:
                    continue
                if only_file:
                    if pt.stringType() != hou.stringParmType.FileReference:
                        continue
                v = p.rawValue()
                if v and isinstance(v, str):
                    yield (p, v)
            except Exception:
                pass


# ============================================================================
# Feature implementations (operate on root = whole hip, no HDA node)
# ============================================================================

def _do_switch_slash(root):
    count = 0
    for p, v in _all_string_parms(root, only_file=False, recursive=True):
        new_v = _normalize_path(v)
        if new_v != v:
            try:
                p.set(new_v)
                count += 1
            except Exception:
                pass
    return '{} parm(s) updated'.format(count)


def _do_replace(root, old, new):
    if not old:
        return '[Replace] old substring is empty, nothing to do.'
    count = 0
    for p, v in _all_string_parms(root, only_file=False, recursive=True):
        if old in v:
            replaced = v.replace(old, new)
            new_v = _normalize_path(replaced)
            if new_v != v:
                try:
                    p.set(new_v)
                    count += 1
                except Exception:
                    pass
    return '{} parm(s) updated'.format(count)


def _do_find_missing(root):
    missing = []
    total_file_nodes = 0
    for n in _walk_all(root):
        if not _is_file_node(n):
            continue
        total_file_nodes += 1
        fp = _get_file_parm(n)
        if fp is None:
            continue
        try:
            v = fp.rawValue()
        except Exception:
            continue
        if not v:
            continue
        expanded = _expand(v)
        if not expanded:
            continue
        if re.search(r'\$\w+', expanded):
            continue
        if not os.path.exists(expanded):
            missing.append((n.path(), n.type().name(), fp.name(), v, expanded))

    if not missing:
        return 'No missing files.'
    lines = ['{} MISSING :'.format(len(missing))]
    for np_, tname, pn, v, e in missing[:200]:
        lines.append('  {:<55}  [{}]  {} = {}'.format(np_, tname, pn, v))
    if len(missing) > 200:
        lines.append('  ... +{} more'.format(len(missing) - 200))
    return '\n'.join(lines)


def _do_switch_abs_rel(root, direction, base, custom_base):
    """Convert file parms between absolute and base-relative."""
    custom_base = (custom_base or '').strip()
    if base == 0:
        base_expanded = hou.text.expandString('$HIP')
        base_var_form = '$HIP'
    elif base == 1:
        base_expanded = hou.text.expandString('$JOB')
        base_var_form = '$JOB'
    else:
        if not custom_base:
            return 'ERROR: Custom Base is empty.'
        base_expanded = hou.text.expandString(custom_base)
        base_var_form = custom_base

    if not base_expanded:
        return 'ERROR: base path is empty.'
    base_norm = _normalize_path(os.path.normpath(base_expanded))
    base_prefix = base_norm.rstrip('/') + '/'
    base_var_prefix = base_var_form.rstrip('/') + '/' if base_var_form else ''

    affected = []
    skipped = []
    for p, v in _all_string_parms(root, only_file=True, recursive=True):
        has_var = bool(re.search(r'\$\w+', v))

        if direction == 0:  # to absolute
            if has_var:
                expanded = _expand(v)
                if expanded and _is_absolute(expanded):
                    new_v = _normalize_path(expanded)
                    if new_v != v:
                        try:
                            p.set(new_v)
                            affected.append((p, v, new_v))
                        except Exception:
                            pass
                continue
            if _is_absolute(v):
                new_v = _normalize_path(os.path.normpath(v))
                if new_v != v:
                    try:
                        p.set(new_v)
                        affected.append((p, v, new_v))
                    except Exception:
                        pass
            else:
                new_v = _normalize_path(os.path.normpath(os.path.join(base_norm, v)))
                if new_v != v:
                    try:
                        p.set(new_v)
                        affected.append((p, v, new_v))
                    except Exception:
                        pass
        else:  # to relative
            if has_var:
                if base_var_prefix and v.startswith(base_var_prefix):
                    continue
                continue
            if not _is_absolute(v):
                continue
            v_norm = _normalize_path(os.path.normpath(v))
            if v_norm == base_norm:
                new_v = base_var_form.rstrip('/') if base_var_form.startswith('$') else '.'
                if new_v != v:
                    try:
                        p.set(new_v)
                        affected.append((p, v, new_v))
                    except Exception:
                        pass
            elif v_norm.startswith(base_prefix):
                rel = v_norm[len(base_norm):].lstrip('/')
                if base_var_form.startswith('$'):
                    new_v = base_var_form.rstrip('/') + '/' + rel
                else:
                    new_v = rel
                new_v = _normalize_path(new_v)
                if new_v != v:
                    try:
                        p.set(new_v)
                        affected.append((p, v, new_v))
                    except Exception:
                        pass
            else:
                skipped.append((p, v))

    seen = set()
    affected_nodes = []
    for p, _, _ in affected:
        np_ = p.node().path()
        if np_ not in seen:
            seen.add(np_)
            affected_nodes.append(p.node())

    verb = '-> Absolute' if direction == 0 else '-> Relative'
    head = '{} : {} parm(s) changed'.format(verb, len(affected))
    lines = [head]
    for p, old_v, new_v in affected:
        line = '  {}: {} = {}  (was: {})'.format(p.node().path(), p.name(), new_v, old_v)
        lines.append(line)
    if skipped:
        lines.append('  (skipped {} parm(s) outside base scope)'.format(len(skipped)))
    return '\n'.join(lines)


# ============================================================================
# Main CLI entry
# ============================================================================

def main():
    ap = argparse.ArgumentParser(description='HIP Path Doctor — fix .hip file paths')
    ap.add_argument('input_hip', help='Path to input .hip file')
    ap.add_argument('output_hip', help='Path to output (fixed) .hip file')
    ap.add_argument('--feature', type=int, required=True, choices=[0, 1, 2, 3],
                    help='0=switch_slash, 1=replace, 2=find_missing, 3=switch_abs_rel')
    ap.add_argument('--old', default='', help='[replace] old substring')
    ap.add_argument('--new', default='', help='[replace] new substring')
    ap.add_argument('--direction', type=int, default=0, choices=[0, 1],
                    help='[switch_abs_rel] 0=to absolute, 1=to relative')
    ap.add_argument('--base', type=int, default=0, choices=[0, 1, 2],
                    help='[switch_abs_rel] 0=$HIP, 1=$JOB, 2=custom')
    ap.add_argument('--custom-base', default='', help='[switch_abs_rel] custom base path')
    ap.add_argument('--hip-base', default='', help='Override $HIP value (else use hip-internal)')
    ap.add_argument('--job-base', default='', help='Override $JOB value (else use hip-internal)')
    ap.add_argument('--input-name', default='',
                    help='Display name of input hip (else use on-disk basename, which may include a server-side prefix).')
    args = ap.parse_args()

    if not os.path.isfile(args.input_hip):
        sys.stderr.write('ERROR: input hip not found: {}\n'.format(args.input_hip))
        sys.exit(1)

    try:
        hou.hipFile.load(args.input_hip, suppress_save_prompt=True)
    except Exception as e:
        sys.stderr.write('ERROR: failed to load .hip: {}\n'.format(e))
        sys.exit(1)

    # hython CLI mode has no GUI $HIP/$JOB set. Pull them out of the loaded
    # hip's internal var table using hou.text.expandString.
    # Note: hip files created via hscript `setenv X = path\with\backslashes` have
    # backslashes eaten (hscript treats \ as escape), so the stored $JOB may
    # already be corrupted. We sanitize by detecting "drive:no-slash" patterns
    # and falling back to the input hip's own directory.
    import re as _re_var

    # 1) Honor CLI overrides first (web form lets the user set their own $HIP/$JOB
    #    because the hip's internal $HIP is often the upload-time directory, not
    #    the user's real project root).
    for varname, override in (('HIP', args.hip_base), ('JOB', args.job_base)):
        if override:
            clean = override.replace('\\', '/').rstrip('/')
            hou.hscript('setenv {} = "{}"'.format(varname, clean))
            sys.stderr.write('VAR: {} = {} (CLI override)\n'.format(varname, clean))

    # 2) Otherwise read from hip's internal var table
    for varname in ('HIP', 'JOB'):
        try:
            val = hou.text.expandString('${}'.format(varname))
        except Exception:
            val = ''
        if val and not val.startswith('$') and _re_var.match(r'^[A-Z]:', val):
            hou.hscript('setenv {} = "{}"'.format(varname, val))
        elif varname == 'HIP':
            # Fallback: HIP = the loaded hip's own directory
            fallback = os.path.dirname(os.path.abspath(args.input_hip)).replace('\\', '/')
            hou.hscript('setenv HIP = "{}"'.format(fallback))
        # else: leave $JOB unset if missing (switch_abs_rel with $JOB will need custom base)

    # 3) Echo final values so API route can show them in the result header
    final_hip = hou.text.expandString('$HIP') or ''
    final_job = hou.text.expandString('$JOB') or ''
    sys.stderr.write('RESOLVED: HIP={} JOB={}\n'.format(final_hip, final_job))

    root = hou.node('/')
    if root is None:
        sys.stderr.write('ERROR: no root node after load.\n')
        sys.exit(1)

    try:
        if args.feature == 0:
            result = _do_switch_slash(root)
        elif args.feature == 1:
            result = _do_replace(root, args.old, args.new)
        elif args.feature == 2:
            result = _do_find_missing(root)
        elif args.feature == 3:
            result = _do_switch_abs_rel(root, args.direction, args.base, args.custom_base)
        else:
            sys.stderr.write('ERROR: unknown feature {}\n'.format(args.feature))
            sys.exit(1)
    except Exception as e:
        sys.stderr.write('ERROR: feature failed: {}\n'.format(e))
        sys.exit(1)

    try:
        out_dir = os.path.dirname(os.path.abspath(args.output_hip))
        if out_dir and not os.path.isdir(out_dir):
            os.makedirs(out_dir)
        hou.hipFile.save(args.output_hip)
    except Exception as e:
        sys.stderr.write('ERROR: failed to save .hip: {}\n'.format(e))
        sys.exit(1)

    # Write the audit log as a Markdown file next to the output .hip. Per
    # user preference (2026-08-19), the .hip itself is kept clean — no
    # sticky note inside the /obj pane. The MD file lives in the same
    # directory as the .hip, with the same stem + `_NexArt_hippathdoctor.md`
    # suffix. The web UI also shows the result text inline.
    try:
        hip_abs = os.path.abspath(args.output_hip)
        hip_dir = os.path.dirname(hip_abs)
        hip_stem = os.path.splitext(os.path.basename(hip_abs))[0]
        md_path = os.path.join(hip_dir, hip_stem + '_NexArt_hippathdoctor.md')

        feature_name = FEATURE_NAMES.get(args.feature, '?')
        header_lines = [
            '# HIP Path Doctor — audit log',
            '',
            '- **Time:** {}'.format(datetime.now().strftime('%Y-%m-%d %H:%M:%S')),
            '- **Input hip:** `{}`'.format(args.input_name or os.path.basename(args.input_hip)),
            '- **Output hip:** `{}`'.format(os.path.basename(args.output_hip)),
            '- **Feature:** {}'.format(feature_name),
            '',
            '## Result',
            '',
            '```',
            result,
            '```',
            '',
        ]
        with open(md_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(header_lines))
        sys.stderr.write('WROTE_AUDIT: {}\n'.format(md_path))
    except Exception as e:
        sys.stderr.write('WARN: failed to write audit md: {}\n'.format(e))

    # Count affected parms from result string (best-effort parse)
    parms_changed = 0
    try:
        first_line = result.split('\n', 1)[0]
        m = re.search(r'(\d+)\s+parm\(s\)', first_line)
        if m:
            parms_changed = int(m.group(1))
    except Exception:
        pass

    summary = {
        'ok': True,
        'feature': args.feature,
        'parms_changed': parms_changed,
        'output_hip': args.output_hip,
        'audit_md': md_path if 'md_path' in dir() and os.path.isfile(md_path) else None,
    }
    sys.stdout.write(json.dumps(summary) + '\n')
    # Wrap result in markers so the API can extract exactly this block from
    # the noisy stderr (which is full of opalias / oplib / deprecation warnings).
    sys.stderr.write('=== HIP DOCTOR RESULT ===\n')
    sys.stderr.write(result + '\n')
    sys.stderr.write('=== /HIP DOCTOR RESULT ===\n')
    sys.exit(0)


if __name__ == '__main__':
    main()
