#!/usr/bin/env python3
"""Lists vercel.json's cron jobs as the lines to create in an outside scheduler (cron-job.org) when the app runs on Render:
URL, header "Authorization: Bearer <CRON_SECRET>", and the schedule in IST (Vercel crons are UTC; IST = UTC + 5:30).
Usage: python3 scripts/print_crons.py https://<your-service>.onrender.com"""
import json, os, sys
base = (sys.argv[1] if len(sys.argv) > 1 else "https://YOUR-SERVICE.onrender.com").rstrip("/")
v = json.load(open(os.path.join(os.path.dirname(__file__), "..", "vercel.json")))
for c in v.get("crons", []):
    m, h, dom, mon, dow = c["schedule"].split()
    ist = ""
    if m.isdigit() and h.isdigit():
        t = int(h) * 60 + int(m) + 330
        ist = f"{(t // 60) % 24:02d}:{t % 60:02d} IST" + (" (+1 day: shift the weekday by one)" if t >= 1440 else "")
    print(f"{base}{c['path']}\n    cron {c['schedule']} UTC  =  {ist}  weekdays {dow}\n")
