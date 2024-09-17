import MTProto from '@mtproto/core';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import util from 'util';

// telegram api cred
const apiId = process.env.API_ID;
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN; // bot token from @BotFather

// initialize MTProto and Bot instances
const mtproto = new MTProto({
    api_id: apiId,
    api_hash: apiHash,
    storageOptions: {
        path: path.resolve("", './session_data.json') // Path to save the session data
    },
});

const bot = new TelegramBot(botToken, { polling: true }); // instead of webhook, using polling

// define global variables
var isExpectingPhoneNumber = false;
var isExpectingVerificationCode = false;


// function to handle API calls with automatic migration handling
const call = async (method, params = {}) => {
    try {
        return await mtproto.call(method, params);
    } catch (error) {
        // handle 'PHONE_MIGRATE_5' 303 error while sending code to user
        if (error.error_message && error.error_message.startsWith('PHONE_MIGRATE')) {
            const newDcId = parseInt(error.error_message.split('_')[2], 10);
            console.log(`Phone number migrated to DC ${newDcId}, redirecting...`);
            mtproto.setDefaultDc(newDcId);
            return await mtproto.call(method, params);
        }
        console.error(`Error during API call: ${method}`, error);
        throw error;
    }
}

// method to start the login process (send code to the user)
const signin = async (chatId, phoneNumber) => {
    try {

        isExpectingPhoneNumber = false; // since we already have phone number

        const { phone_code_hash } = await call('auth.sendCode', {
            phone_number: '+' + phoneNumber,
            settings: {
                _: 'codeSettings',
            },
        });

        // ask user to share the verification code
        await bot.sendMessage(chatId, `Code sent to your phone number. Please enter the code:`);

        // now we are expecting a code from user
        isExpectingVerificationCode = true;

        // add a delay of 60secs, meanwhile user will share the verification code, and we will save it
        await delay(60000, "set delay");

        // fetch verification code shared by the user from file
        const code = await getVerificationCode();

        // code validation
        if (!code) {
            bot.sendMessage(chatId, 'Login failed! Please try again after sometime.');
            return;
        }

        // call sigin api
        const authResult = await call('auth.signIn', {
            phone_number: '+' + phoneNumber,
            phone_code_hash,
            phone_code: code,
        });

        // save session to the file
        fs.writeFileSync('./session_data.json', JSON.stringify(authResult));

        // success message
        bot.sendMessage(chatId, 'Logged in successfully.');

    } catch (error) {
        console.error('Error during login:', error);
        bot.sendMessage(chatId, `Failed to signin: ${error.error_message}`);
    }
}

// method to save the code shared by user
const saveVerificationCode = (code) => {
    try {
        fs.writeFileSync('./config.json', JSON.stringify({ code }));
        isExpectingVerificationCode = false;
    } catch (error) {
        console.error('Error:', error);
    }
};

// method to read the code from file
const getVerificationCode = async () => {
    try {
        const readFileAsync = util.promisify(fs.readFile);
        const data = await readFileAsync('config.json', 'utf8');
        const parsedData = JSON.parse(data);
        return parsedData?.code;
    } catch (parseError) {
        console.error('Error parsing JSON:', parseError);
        return null;
    }
};

// method to create a group with two users
const createGroup = async (users, groupName) => {
    try {
        // create a group chat
        const result = await call('messages.createChat', {
            users, // array of user IDs
            title: groupName,
        });
        console.log(`Group created with ID ${result?.chats[0]?.id} and name ${groupName}`);

        // generate a group invite link
        const inviteLink = await call('messages.exportChatInvite', {
            chat_id: result?.chats[0]?.id // group id
        });
        console.log('Group invite link:', inviteLink?.link);

        return inviteLink?.link;
    } catch (error) {
        console.error('Error creating group:', error);
    }
}

// handle '/group' command separately
bot.onText(/\/group(.*)/, async (msg, match) => {
    const chatId = msg?.chat?.id;
    const senderId = msg?.from?.id;
    const targetUserId = msg?.reply_to_message ? msg?.reply_to_message?.from?.id : null;
    const groupName = match[1] || `${msg?.from?.first_name} <> ${targetUserId}`; // need to change the logic

    if (!targetUserId) {
        bot.sendMessage(chatId, 'Please reply to someone with the /group command to create a group.');
        return;
    }

    const users = [senderId, targetUserId]; // User IDs to add to the group
    const inviteLink = await createGroup(users, groupName);

    bot.sendMessage(chatId, `Group created: ${inviteLink}, Introlink Bot: https://t.me/introlinkbot?start=Lewis2204`);
});

// Listen for the user input
bot.on('message', (msg) => {
    const chatId = msg?.chat?.id;
    const text = msg?.text?.trim();

    // handle login command
    if (text === '/login') {
        bot.sendMessage(chatId, "Please enter a Phone number in international format (e.g., '619999999999', where 61 represents country code.)");
        isExpectingPhoneNumber = true;

    } else if (/^\d{5}$/.test(text) && isExpectingVerificationCode) {

        // if the message is a valid varification code (5 digits)
        saveVerificationCode(text); // Pass the entered code to the login function

    } else if (/^\d{10,14}$/.test(text) && isExpectingPhoneNumber) {

        // if the message is a valid phone number (atleast 10 and at max 14 digits)
        signin(chatId, text);

    } else if (/\/group(.*)/.test(text)) {

        // already handling this group command
        console.log("Group Command");
    } else {

        // ask user for a valid input
        bot.sendMessage(chatId, 'Please enter a valid input.');
    }
});

function delay(time, msg) {
    return new Promise((resolve) => {
        setTimeout(resolve, time);
        console.log("Info:", msg);
    });
}