import os
import sys

import httpx


def main():
    api_url = os.getenv("STORYFLICKS_API_URL", "").rstrip("/")
    scheduler_secret = os.getenv("SCHEDULER_SECRET", "")

    if not api_url or not scheduler_secret:
        print("Missing STORYFLICKS_API_URL or SCHEDULER_SECRET.")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {scheduler_secret}",
    }

    jobs = {
        "author notes": "/api/internal/publish-due-author-notes",
        "episodes": "/api/internal/publish-due-episodes",
    }

    try:
        with httpx.Client(timeout=60.0) as client:
            for job_name, path in jobs.items():
                response = client.post(
                    f"{api_url}{path}",
                    headers=headers,
                )
                response.raise_for_status()
                result = response.json()

                count = result.get("published_count", 0)
                print(f"Scheduled publishing: {count} {job_name} published.")

    except httpx.HTTPError as exc:
        print(f"Scheduled publishing failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
