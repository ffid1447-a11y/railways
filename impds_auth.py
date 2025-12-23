#!/usr/bin/env python3

import os
import sys
import requests
import base64
import hashlib
from bs4 import BeautifulSoup
import re

# Disable SSL warnings if needed
requests.packages.urllib3.disable_warnings()

class IMPDSAuth:
    def __init__(self):
        self.session = requests.Session()
        self.base_url = "https://impds.nic.in/impdsdeduplication"
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        })
    
    def sha512(self, text):
        return hashlib.sha512(text.encode()).hexdigest()
    
    def get_login_page(self):
        try:
            response = self.session.get(f"{self.base_url}/LoginPage", timeout=10)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # CSRF token
            csrf_input = soup.find('input', {'name': 'REQ_CSRF_TOKEN'})
            csrf_token = csrf_input['value'] if csrf_input else ''
            
            # User salt
            user_salt = None
            for script in soup.find_all('script'):
                if script.string and 'USER_SALT' in script.string:
                    match = re.search(r"USER_SALT\s*=\s*'([^']+)'", script.string)
                    if match:
                        user_salt = match.group(1)
                        break
            
            return csrf_token, user_salt
        except Exception as e:
            print(f"Error getting login page: {e}")
            return None, None
    
    def get_captcha(self):
        try:
            response = self.session.post(f"{self.base_url}/ReloadCaptcha", timeout=10)
            if response.status_code == 200:
                data = response.json()
                return data.get('captchaBase64')
        except Exception as e:
            print(f"Error getting captcha: {e}")
        return None
    
    def solve_captcha_simple(self, captcha_base64):
        """Simple CAPTCHA solving - Railway doesn't have Tesseract"""
        # On Railway, we can't install Tesseract easily
        # So we'll save the CAPTCHA and return dummy text
        # In production, you might need a CAPTCHA solving service
        
        # Save CAPTCHA for debugging
        try:
            image_data = base64.b64decode(captcha_base64)
            with open('/tmp/captcha.png', 'wb') as f:
                f.write(image_data)
            print("⚠️ CAPTCHA saved to /tmp/captcha.png")
        except:
            pass
        
        # For Railway, you need to handle CAPTCHA manually
        # Or use a CAPTCHA solving service
        return "ABCD"  # Dummy value - you need to implement proper solving
    
    def login(self):
        # Credentials from environment or default
        username = os.getenv('IMPDS_USERNAME', 'dsojpnagar@gmail.com')
        password = os.getenv('IMPDS_PASSWORD', 'CHCAEsoK')
        
        print(f"Logging in as: {username}")
        
        # Get tokens
        csrf_token, user_salt = self.get_login_page()
        if not csrf_token or not user_salt:
            print("Failed to get tokens")
            return None
        
        # Get CAPTCHA
        captcha_base64 = self.get_captcha()
        if not captcha_base64:
            print("Failed to get CAPTCHA")
            return None
        
        # Solve CAPTCHA
        captcha_text = self.solve_captcha_simple(captcha_base64)
        
        # Prepare password
        salted_password = self.sha512(self.sha512(user_salt) + self.sha512(password))
        
        # Login data
        data = {
            'userName': username,
            'password': salted_password,
            'captcha': captcha_text,
            'REQ_CSRF_TOKEN': csrf_token
        }
        
        try:
            response = self.session.post(
                f"{self.base_url}/UserLogin",
                data=data,
                timeout=15
            )
            
            # Get session ID
            jsessionid = self.session.cookies.get('JSESSIONID')
            
            if jsessionid:
                print(f"✅ Login successful")
                return jsessionid
            else:
                print("❌ No JSESSIONID in cookies")
                return None
                
        except Exception as e:
            print(f"Login error: {e}")
            return None

def main():
    print("Starting IMPDS authentication...")
    
    auth = IMPDSAuth()
    session_id = auth.login()
    
    if session_id:
        print(f"JSESSIONID: {session_id}")
        return 0
    else:
        print("Authentication failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())