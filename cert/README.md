### Generate self-signed certificate

Detailed instructions: http://www.akadia.com/services/ssh_test_certificate.html


#### Step 1: Generate a Private Key

    openssl genrsa -des -out dummy.key 2048


#### Step 2: Generate a CSR (Certificate Signing Request)

    openssl req -new -key dummy.key -out dummy.csr


#### Step 3: Remove Passphrase from Key

    openssl rsa -in dummy.key -out dummy.key


#### Step 4: Generating a Self-Signed Certificate

    openssl x509 -req -days 365 -in dummy.csr -signkey dummy.key -out dummy.crt
