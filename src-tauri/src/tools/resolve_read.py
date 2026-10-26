# spatialdb desktop — the Resolve timeline tool's reader (RESOLVE-BRIEF.md R2.2).
#
# Compiled INTO the desktop app (resolve.rs, include_str!) and fed to the host's
# python3 on stdin; nothing here comes from the server. It asks the RUNNING
# DaVinci Resolve, through its scripting API, about the open project, and prints
# ONE JSON document on stdout. It only READS: no call below changes the project.
#
#   python3 - list            the project's timelines, and which is current
#   python3 - read [NAME]     one timeline (the current one when NAME is absent)
#
# Raw facts only — frame numbers, Resolve's own words. Timecode labels, the frame
# rate's rounding and the output keys are made in Rust (resolve.rs), where they
# are tested; this file stays a thin, readable list of API calls.
#
# The API names are from Resolve's Developer/Scripting/README.txt (19/20). Each
# call is made through `call`, so an API that differs on the owner's version
# fails naming the call, not as a Python traceback.

import json
import sys


def emit(doc):
    sys.stdout.write(json.dumps(doc))
    sys.stdout.flush()


def fail(message):
    emit({"ok": False, "error": message})
    sys.exit(0)


def call(what, fn, *args):
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001 — anything Resolve raises is reported, by call
        fail("Resolve's %s failed: %s" % (what, e))


try:
    import DaVinciResolveScript as dvr
except ImportError as e:
    fail("python3 could not import Resolve's scripting module (DaVinciResolveScript): %s. "
         "Set SPATIALDB_RESOLVE_API to the folder that holds Modules/." % e)

resolve = dvr.scriptapp("Resolve")
if not resolve:
    fail("Resolve did not answer. Is it running? External scripting must be on: "
         "Preferences → System → General → External scripting using: Local "
         "(DaVinci Resolve Studio only).")

pm = call("GetProjectManager", resolve.GetProjectManager)
project = call("GetCurrentProject", pm.GetCurrentProject) if pm else None
if not project:
    fail("No project is open in Resolve.")

version = call("GetVersionString", resolve.GetVersionString)
project_name = call("GetName (project)", project.GetName)
mode = sys.argv[1] if len(sys.argv) > 1 else "list"


def timelines():
    n = int(call("GetTimelineCount", project.GetTimelineCount) or 0)
    out = []
    for i in range(1, n + 1):
        t = call("GetTimelineByIndex", project.GetTimelineByIndex, i)
        if t:
            out.append(t)
    return out


def current_name():
    t = call("GetCurrentTimeline", project.GetCurrentTimeline)
    return call("GetName (timeline)", t.GetName) if t else None


if mode == "list":
    emit({
        "ok": True,
        "version": version,
        "project": project_name,
        "timelines": [call("GetName (timeline)", t.GetName) for t in timelines()],
        "current": current_name(),
    })
    sys.exit(0)

if mode != "read":
    fail("unknown mode %r" % mode)

wanted = sys.argv[2] if len(sys.argv) > 2 else None
timeline = None
if wanted is None:
    timeline = call("GetCurrentTimeline", project.GetCurrentTimeline)
    if not timeline:
        fail("No timeline is open in project \"%s\"." % project_name)
else:
    for t in timelines():
        if call("GetName (timeline)", t.GetName) == wanted:
            timeline = t
            break
    if not timeline:
        fail("Project \"%s\" has no timeline named \"%s\" (renamed or deleted since the list was read?)." % (project_name, wanted))


def setting(key):
    # A timeline using the project's settings may answer "" for its own: ask the project then.
    v = call("GetSetting(%s)" % key, timeline.GetSetting, key)
    if v in (None, ""):
        v = call("GetSetting(%s) (project)" % key, project.GetSetting, key)
    return v


tracks = []
for i in range(1, int(call("GetTrackCount(audio)", timeline.GetTrackCount, "audio") or 0) + 1):
    items = call("GetItemListInTrack(audio, %d)" % i, timeline.GetItemListInTrack, "audio", i) or []
    clips = []
    for it in items:
        mpi = call("GetMediaPoolItem", it.GetMediaPoolItem)
        path = call("GetClipProperty(File Path)", mpi.GetClipProperty, "File Path") if mpi else None
        clips.append({
            "name": call("GetName (item)", it.GetName),
            "start": call("GetStart", it.GetStart),
            "duration": call("GetDuration", it.GetDuration),
            "end": call("GetEnd", it.GetEnd),
            "path": path if isinstance(path, str) and path else None,
        })
    tracks.append({
        "index": i,
        "name": call("GetTrackName(audio, %d)" % i, timeline.GetTrackName, "audio", i),
        "format": call("GetTrackSubType(audio, %d)" % i, timeline.GetTrackSubType, "audio", i),
        "clips": clips,
    })

emit({
    "ok": True,
    "version": version,
    "project": project_name,
    "timeline": {
        "name": call("GetName (timeline)", timeline.GetName),
        "width": setting("timelineResolutionWidth"),
        "height": setting("timelineResolutionHeight"),
        "rate": setting("timelineFrameRate"),
        "drop": setting("timelineDropFrameTimecode"),
        "start_timecode": call("GetStartTimecode", timeline.GetStartTimecode),
        "start_frame": call("GetStartFrame", timeline.GetStartFrame),
        "end_frame": call("GetEndFrame", timeline.GetEndFrame),
    },
    "tracks": tracks,
})
