
import getpass
import httpx

from app.core.config import settings

email = input("Reader email: ").strip()
password = getpass.getpass("Reader password: ")

response = httpx.post(
    f"{settings.supabase_auth_url}/token",
    params={"grant_type": "password"},
    headers={"apikey": settings.supabase_anon_key},
    json={
        "email": email,
        "password": password,
    },
    timeout=20,
)

if response.status_code != 200:
    print("Sign-in failed:", response.status_code)
    print(response.text)
    raise SystemExit(1)

data = response.json()

with open(".reader_token", "w") as file:
    file.write(data["access_token"])

print("Reader signed in successfully.")
print("Fresh access token saved locally to .reader_token.")


