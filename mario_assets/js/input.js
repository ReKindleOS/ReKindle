(function () {
    var pressedKeys = {};
    var pressedKeysKeyboard = {};

    function setKey(event, status, isKeyboard) {
        var code = event.keyCode;
        var key;

        switch (code) {
            case 32:
                key = 'SPACE'; break;
            case 37:
                key = 'LEFT'; break;
            case 38:
                key = 'UP'; break;
            case 39:
                key = 'RIGHT'; break;
            case 40:
                key = 'DOWN'; break;
            case 88:
                key = 'JUMP'; break;
            case 90:
                key = 'RUN'; break;
            case 65:
                key = 'A'; break;
            default:
                key = String.fromCharCode(code);
        }

        pressedKeys[key] = status;
        if (isKeyboard) {
            pressedKeysKeyboard[key] = status;
        }
    }

    document.addEventListener('keydown', function (e) {
        setKey(e, true, true);
    });

    document.addEventListener('keyup', function (e) {
        setKey(e, false, true);
    });

    window.addEventListener('blur', function () {
        pressedKeys = {};
        pressedKeysKeyboard = {};
    });

    window.input = {
        isDown: function (key) {
            return pressedKeys[key.toUpperCase()];
        },
        isKeyboardDown: function (key) {
            return pressedKeysKeyboard[key.toUpperCase()];
        },
        setKeyState: function (key, status) {
            pressedKeys[key.toUpperCase()] = status;
        },
        reset: function () {
            pressedKeys['RUN'] = false;
            pressedKeys['LEFT'] = false;
            pressedKeys['RIGHT'] = false;
            pressedKeys['DOWN'] = false;
            pressedKeys['JUMP'] = false;
            pressedKeysKeyboard = {};
        }
    };
})();
