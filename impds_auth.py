import requests
import base64
import hashlib
from bs4 import BeautifulSoup
import re
import pytesseract
from PIL import Image
import io
import sys

class IMPDSAuth:
    def __init__(self):
        self.session = requests.Session()
        self.base_url = "https://impds.nic.in/impdsdeduplication"
        
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        })
    
    def sha512(self, text):
        return hashlib.sha512(text.encode()).hexdigest()
    
    def get_tokens(self):
        response = self.session.get(f"{self.base_url}/LoginPage")
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
    
    def get_captcha(self):
        response = self.session.post(f"{self.base_url}/ReloadCaptcha")
        if response.status_code == 200:
            data = response.json()
            return data.get('captchaBase64')
        return None
    
    def solve_captcha(self, captcha_base64):
        try:
            image_data = base64.b64decode(captcha_base64)
            image = Image.open(io.BytesIO(image_data))
            image = image.convert('L')
            
            text = pytesseract.image_to_string(image, config='--psm 8').strip()
            text = ''.join(c for c in text if c.isalnum()).upper()
            
            if len(text) >= 4:
                return text
        except:
            pass
        return None
    
    def login(self):
        # Credentials
        username = "dsojpnagar@gmail.com"
        password = "CHCAEsoK"
        
        # Get tokens
        csrf_token, user_salt = self.get_tokens()
        if not csrf_token or not user_salt:
            return None
        
        # Get CAPTCHA
        captcha_base64 = self.get_captcha()
        if not captcha_base64:
            return None
        
        # Solve CAPTCHA
        captcha_text = self.solve_captcha(captcha_base64)
        if not captcha_text:
            # Manual input
            with open("captcha.png", "wb") as f:
                f.write(base64.b64decode(captcha_base64))
            print("Enter CAPTCHA from captcha.png:")
            captcha_text = input("> ").strip().upper()
        
        # Prepare password
        salted_password = self.sha512(self.sha512(user_salt) + self.sha512(password))
        
        # Login data
        data = {
            'userName': username,
            'password': salted_password,
            'captcha': captcha_text,
            'REQ_CSRF_TOKEN': csrf_token
        }
        
        # Login request
        response = self.session.post(f"{self.base_url}/UserLogin", data=data)
        
        # Get session ID
        jsessionid = self.session.cookies.get('JSESSIONID')
        return jsessionid

def main():
    auth = IMPDSAuth()
    session_id = auth.login()
    
    if session_id:
        print(f"JSESSIONID: {session_id}")
        return 0
    else:
        print("Login failed")
        return 1

if __name__ == "__main__":
    main()
