#!/usr/bin/env python3
"""
Run this on YOUR LOCAL MACHINE. It will:

  1. SSH to the VPS, read the deploy user's private key.
  2. Encrypt it with libsodium sealed box.
  3. PUT it to the GitHub repo's production-environment secret.

Requirements:
  pip install paramiko pynacl requests

Usage:
  python3 upload-vps-key-local.py \
      --vps-host <vps-ip> \
      --vps-user ubuntu \
      --vps-key  ~/.ssh/id_ed25519 \
      --deploy-user selffeed-deploy \
      --github-token ghp_xxx \
      --repo Gustav0ar/Self-RSS \
      --env production
"""

import argparse
import base64
import json
import sys

import requests


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--vps-host", required=True)
    p.add_argument("--vps-user", required=True, help="SSH user with sudo on VPS")
    p.add_argument("--vps-key", required=True, help="Path to your SSH key for the VPS")
    p.add_argument("--vps-port", type=int, default=22)
    p.add_argument("--deploy-user", default="selffeed-deploy")
    p.add_argument("--github-token", required=True)
    p.add_argument("--repo", required=True)
    p.add_argument("--env", default="production")
    p.add_argument("--secret", default="VPS_SSH_KEY")
    return p.parse_args()


def fetch_repo_key(token, repo):
    r = requests.get(
        f"https://api.github.com/repos/{repo}/actions/secrets/public-key",
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
        },
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def encrypt(plaintext: bytes, public_key_b64: str) -> str:
    import nacl.public
    pub = nacl.public.PublicKey(base64.b64decode(public_key_b64))
    sealed = nacl.public.SealedBox(pub)
    return base64.b64encode(sealed.encrypt(plaintext)).decode("ascii")


def fetch_vps_key(args) -> bytes:
    import paramiko
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.RSAKey.from_private_key_file(args.vps_key) \
        if args.vps_key.endswith(("rsa", ".pem")) \
        else paramiko.Ed25519Key.from_private_key_file(args.vps_key)
    client.connect(
        hostname=args.vps_host,
        port=args.vps_port,
        username=args.vps_user,
        pkey=pkey,
        timeout=15,
    )
    try:
        cmd = f"sudo cat /var/lib/{args.deploy_user}/.ssh/id_ed25519"
        stdin, stdout, stderr = client.exec_command(cmd)
        stdout.channel.settimeout(15)
        data = stdout.read()
        if not data:
            err = stderr.read().decode("utf-8", "replace")
            raise SystemExit(f"Failed to read key from VPS: {err}")
        return data
    finally:
        client.close()


def put_secret(token, repo, env, secret_name, encrypted_b64, key_id):
    url = f"https://api.github.com/repos/{repo}/environments/{env}/secrets/{secret_name}"
    r = requests.put(
        url,
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
        data=json.dumps({"encrypted_value": encrypted_b64, "key_id": key_id}),
        timeout=15,
    )
    if r.status_code not in (201, 204):
        raise SystemExit(f"PUT {url} -> HTTP {r.status_code}\n{r.text}")
    return r


def main():
    args = parse_args()

    print(f">> Fetching deploy key from {args.vps_host}...")
    priv = fetch_vps_key(args)
    if b"PRIVATE KEY" not in priv.split(b"\n", 1)[0]:
        raise SystemExit("Fetched content does not look like a private key.")

    print(f">> Fetching GitHub repo public key for {args.repo}...")
    pk = fetch_repo_key(args.github_token, args.repo)
    print(f"   key_id = {pk['key_id']}")

    print(">> Encrypting...")
    encrypted = encrypt(priv, pk["key"])
    print(f"   encrypted payload: {len(encrypted)} bytes (b64)")

    print(f">> Uploading to {args.repo} environment={args.env} secret={args.secret}...")
    put_secret(args.github_token, args.repo, args.env, args.secret, encrypted, pk["key_id"])
    print("OK — secret updated. Re-run the Deploy workflow from the Actions tab.")


if __name__ == "__main__":
    main()
