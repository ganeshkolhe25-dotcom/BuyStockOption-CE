from norenapi import NorenApi
import pyotp
import os
from dotenv import load_dotenv

# Load credentials from .env
load_dotenv()

# Replace with your actual credentials from .env
# uid, pwd (hashed), factor2, vc, appkey
username = os.getenv('SHOONYA_UID')
password = os.getenv('SHOONYA_PWD') # Assumed already hashed in .env
vendor_code = os.getenv('SHOONYA_VC')
api_key = os.getenv('SHOONYA_APPKEY')
totp_secret = os.getenv('SHOONYA_FACTOR2')

class ShoonyaTest(NorenApi):
    def __init__(self):
        # NOTE: If NorenWClientTP fails (502), try NorenWClient/
        # base_url = "https://api.shoonya.com/NorenWClientTP/"
        base_url = "https://api.shoonya.com/NorenWClient/"
        NorenApi.__init__(self, host=base_url, websocket="wss://api.shoonya.com/NorenWClient/")
        self.set_api_key(api_key)

if __name__ == "__main__":
    if not all([username, password, vendor_code, api_key, totp_secret]):
        print("❌ Missing credentials in .env file.")
        exit(1)

    print(f"Testing Shoonya Connection for UID: {username}")
    api = ShoonyaTest()
    
    # Generate TOTP
    token = pyotp.TOTP(totp_secret).now()
    print(f"Generated TOTP: {token}")

    # Test Login
    try:
        login_response = api.login(
            userid=username, 
            password=password, 
            twoFA=token, 
            vendor_code=vendor_code, 
            api_key=api_key, 
            imei='1234'
        )

        if login_response and login_response.get('stat') == 'Ok':
            print("✅ Login Successful!")
            print(f"Session Token: {login_response.get('susertoken')[:10]}...")
            
            # Test fetching data to ensure full connectivity
            print("Fetching Order Book...")
            orders = api.get_order_book()
            print(f"Order Book Response Type: {type(orders)}")
            if isinstance(orders, list):
                print(f"Found {len(orders)} orders.")
            else:
                print(f"Response: {orders}")
        else:
            print(f"❌ Login Failed: {login_response.get('emsg') if login_response else 'Unknown error'}")
            print(f"Full Response: {login_response}")
    except Exception as e:
        print(f"❌ Protocol/Connection Error: {str(e)}")
