const crypto = require('crypto');
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

readline.question('Enter your Shoonya Raw Password to hash securely: ', password => {
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    console.log('\n--- SUCCESS ---');
    console.log('Copy this sha256 hash completely and paste it into the SHOONYA_PWD variable in your .env file:');
    console.log('\x1b[32m%s\x1b[0m', hash); // Green color
    console.log('---------------\n');
    readline.close();
});
