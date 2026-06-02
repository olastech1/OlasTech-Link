import paramiko
import sys

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect('144.126.203.142', username='root', password='0703841@$Ola', timeout=10)
    stdin, stdout, stderr = client.exec_command('docker logs omada-controller | tail -n 50')
    print("STDOUT:")
    print(stdout.read().decode('utf-8'))
    print("STDERR:")
    print(stderr.read().decode('utf-8'))
    
    stdin, stdout, stderr = client.exec_command('docker ps -a')
    print("PS STDOUT:")
    print(stdout.read().decode('utf-8'))
except Exception as e:
    print("Error:", e)
finally:
    client.close()
