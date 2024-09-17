import { resolve } from 'path';
import MTProto from '@mtproto/core';
import { sleep } from '@mtproto/core/src/utils/common/index.js';

// boilerplate code for testing sign up and login using Test phone numbers, they only work on test DCs

class API {
    constructor() {
        this.mtproto = new MTProto({
            api_id: process.env.API_ID,
            api_hash: process.env.API_HASH,
            test: true,
            storageOptions: {
                path: resolve("./src", './data/1.json'),
            },
        });
    }

    async call(method, params, options = {}) {
        try {
            const result = await this.mtproto.call(method, params, options);

            return result;
        } catch (error) {
            console.log(`${method} error:`, error);

            const { error_code, error_message } = error;

            if (error_code === 420) {
                const seconds = Number(error_message.split('FLOOD_WAIT_')[1]);
                const ms = seconds * 1000;

                await sleep(ms);

                return this.call(method, params, options);
            }

            if (error_code === 303) {
                const [type, dcIdAsString] = error_message.split('_MIGRATE_');

                const dcId = Number(dcIdAsString);

                // If auth.sendCode call on incorrect DC need change default DC, because
                // call auth.signIn on incorrect DC return PHONE_CODE_EXPIRED error
                if (type === 'PHONE') {
                    await this.mtproto.setDefaultDc(dcId);
                } else {
                    Object.assign(options, { dcId });
                }

                return this.call(method, params, options);
            }

            return Promise.reject(error);
        }
    }
}

const api = new API();

async function getUser() {
    try {
        const user = await api.call('users.getFullUser', {
            id: {
                _: 'inputUserSelf',
            },
        });

        return user;
    } catch (error) {
        return null;
    }
}

function sendCode(phone) {
    return api.call('auth.sendCode', {
        phone_number: phone,
        settings: {
            _: 'codeSettings',
        },
    });
}

function signIn({ code, phone, phone_code_hash }) {
    return api.call('auth.signIn', {
        phone_code: code,
        phone_number: phone,
        phone_code_hash: phone_code_hash,
    });
}

(async () => {
    const user = await getUser();

    const phone = '+99966XYYYY';
    const code = 'XXXXXX';

    if (!user) {
        const { phone_code_hash } = await sendCode(phone);

        try {
            const signInResult = await signIn({
                code,
                phone,
                phone_code_hash,
            });
        } catch (error) {
            console.log(`error:`, error);
        }
    }
})();

export default api;