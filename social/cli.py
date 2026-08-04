"""`social` command-line entrypoint.

Usage:
  social status
  social post x "hello world"
  social post reddit --subreddit python --title "..." --text "..."
  social post facebook "hello"
  social post instagram --image-url https://... --text "..."
  social reply x <tweet_id> "nice"
  social like x <tweet_id>
  social retweet x <tweet_id>
  social feeds [--platform all|x|reddit|facebook|instagram] [--limit 10]
  social serve [--host 127.0.0.1] [--port 8731]
"""

from __future__ import annotations

import argparse
import json
import sys

from . import config, platforms
from .server import main as serve_main


def _print(res: dict) -> int:
    print(json.dumps(res, indent=2, default=str))
    return 0 if res.get("ok") else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="social")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="show configured platforms")

    p = sub.add_parser("post")
    p.add_argument("platform", choices=["x", "reddit", "facebook", "instagram"])
    p.add_argument("text", nargs="?", default="")
    p.add_argument("--subreddit", default="")
    p.add_argument("--title", default="")
    p.add_argument("--url", default="")
    p.add_argument("--image-url", dest="image_url", default="")

    r = sub.add_parser("reply")
    r.add_argument("platform", choices=["x", "reddit"])
    r.add_argument("target_id")
    r.add_argument("text")

    l = sub.add_parser("like")
    l.add_argument("target_id")
    rt = sub.add_parser("retweet")
    rt.add_argument("target_id")

    f = sub.add_parser("feeds")
    f.add_argument("--platform", default="all")
    f.add_argument("--limit", type=int, default=10)
    f.add_argument("--subreddit", default="")

    sub.add_parser("serve")

    args, extra = ap.parse_known_args(argv)

    if args.cmd == "status":
        return _print({"ok": True, "configured": config.configured()})
    if args.cmd == "post":
        if args.platform == "x":
            return _print(platforms.x_post(args.text))
        if args.platform == "reddit":
            return _print(platforms.reddit_post(args.subreddit, args.title, text=args.text, url=args.url))
        if args.platform == "facebook":
            return _print(platforms.fb_post(args.text))
        if args.platform == "instagram":
            return _print(platforms.ig_post(args.image_url, caption=args.text))
    if args.cmd == "reply":
        if args.platform == "x":
            return _print(platforms.x_reply(args.target_id, args.text))
        return _print(platforms.reddit_reply(args.target_id, args.text))
    if args.cmd == "like":
        return _print(platforms.x_like(args.target_id))
    if args.cmd == "retweet":
        return _print(platforms.x_retweet(args.target_id))
    if args.cmd == "feeds":
        plat = args.platform
        if plat in ("all", "x"):
            print("== X mentions ==")
            _print(platforms.x_feeds(args.limit))
        if plat in ("all", "reddit"):
            print("== Reddit ==")
            _print(platforms.reddit_feeds(args.limit, subreddit=args.subreddit))
        if plat in ("all", "facebook"):
            print("== Facebook ==")
            _print(platforms.fb_feeds(args.limit))
        if plat in ("all", "instagram"):
            print("== Instagram ==")
            _print(platforms.ig_feeds(args.limit))
        return 0
    if args.cmd == "serve":
        # forward any extra args (e.g. --port) through to the server CLI
        serve_main(extra)
        return 0
    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
