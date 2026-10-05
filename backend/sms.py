"""SMS.RU adapter. No code/token is included in HTTP error responses."""
import json
import os
from urllib.request import Request, urlopen
from urllib.parse import urlencode

class DeliveryError(Exception): pass

def send_code(phone, code, user_id):
    if os.environ.get('BOKOBOK_LOG_OTP')=='1' and os.environ.get('BOKOBOK_HOST','127.0.0.1') in ('127.0.0.1','localhost'):
        print(f'Local OTP for {user_id}: {code}', flush=True)
        return
    api_key=os.environ.get('SMS_RU_API_ID')
    if not api_key: raise DeliveryError('Отправка SMS ещё не настроена. Обратитесь к администратору.')
    if not phone: raise DeliveryError('В учётной записи не указан телефон. Обратитесь к администратору.')
    number=phone.lstrip('+')
    request=Request('https://sms.ru/sms/send',data=urlencode({'api_id':api_key,'to':number,'msg':f'Бок о бок: код входа {code}. Действует 5 минут.','json':1}).encode(),method='POST')
    try:
        with urlopen(request,timeout=8) as response: result=json.load(response)
        if result.get('status_code')!=100 or result.get('sms',{}).get(number,{}).get('status_code')!=100: raise ValueError('Delivery declined')
    except Exception as exc: raise DeliveryError('Не удалось отправить SMS. Попробуйте позже.') from exc
