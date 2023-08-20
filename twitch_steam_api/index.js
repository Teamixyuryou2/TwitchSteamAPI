const fs = require("fs");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

const[{client_id, client_secret, grant_type},{key}] = require('./auth/credentials.json');

port = 3000;

/* Allow multiple different sessions */
const all_sessions = []
const server = http.createServer();

server.on('listen', listen_handler);
server.listen(port);
function listen_handler() {
    console.log(`Now Listening on Port ${port}`);
}

server.on("request", request_handler);

function request_handler(req, res){
    /*First page user sees with a text bpx */
    if (req.url === "/") {
        const form = fs.createReadStream("html/index.html");
        res.writeHead(200, {"Content-Type": "text/html"});
        form.pipe(res);
    }
    /* We have the streamerid we want to search but we need access to the Twitch API to search so we receive_access_token*/
    else if (req.url.startsWith("/search_streamer_id")) {
        const user_input = new URL(req.url, `https://${req.headers.host}`).searchParams;
        const streamerid = user_input.get("streamerid");
        if (streamerid == null || streamerid === "") {
            not_found(res);
            return;
        }
        const state = crypto.randomBytes(20).toString("hex");
        all_sessions.push({streamerid, state});
        
        twitch_receive_access_token(state, streamerid, res);
    } 
    /* In here we want to get access token to use the Twitch API so we make a post which will respond back with {access_token, expires_in, token_type}*/
    function twitch_receive_access_token(state, streamerid, res){
        const token_endpoint = "https://id.twitch.tv/oauth2/token";
        let post_data = new URLSearchParams({state, client_id, client_secret, grant_type}).toString();
        let options = {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        };
        
        https.request(token_endpoint, options, 
            (token_stream) => process_stream(token_stream, get_twitch_token, streamerid, client_id, res)
        ).end(post_data);
    }

    function process_stream(stream, callback, ...args) {
        let body = "";
        stream.on("data", (chunk) => (body += chunk));
        stream.on("end", () => callback(body, ...args));
    }

    /* In here the access token is saved and sent into twitch api for it to work */
    function get_twitch_token(body, streamerid, client_id, res) {
        const {access_token} = JSON.parse(body);
        get_streamer_game(streamerid, access_token, client_id, res);
    }

    /*Using the user_input, access_token, and client_id, we feed it into the endpoint to get the info we need*/
    function get_streamer_game(streamerid, access_token, client_id, res){

        const twitch_task_endpoint = `https://api.twitch.tv/helix/channels?broadcaster_id=${streamerid}`;

        const options = {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${access_token}`,
                'Client-Id': `${client_id}`
            },
        };
        
        https.request(twitch_task_endpoint, options, 
            (streamer_data_stream) => process_stream(streamer_data_stream, get_game_name, res)
        ).end();
    
    }

    function get_game_name(body, res){
        const streamerData = JSON.parse(body);
        if (streamerData != null){
            if (streamerData.data != null && streamerData.data.length > 0){
                if(streamerData.data[0].game_name != ""){
                    const game_name = streamerData.data[0].game_name;
                    const streamer_name = streamerData.data[0].broadcaster_name;
                    res.write(`<div style="font-size: 40px">${streamer_name} played ${game_name}</div>` , () =>  get_steam_game_list(game_name));   /*Server -> Client : RES: Streamer Name and Game Name*/
                    }
                else{
                    no_recent_played();
                }
            }
            else{
                no_recent_played();
            }
        }
        else{
            no_recent_played();
        }
        
    }
    
    function get_steam_game_list(twitch_game_name){
        steamAPIkey = key;
        const steam_appid_endpoint = `https://api.steampowered.com/IStoreService/GetAppList/v1/?key=${steamAPIkey}`;
        const options = {
            method: 'GET',
        }
        
        https.request(steam_appid_endpoint, options, 
            (game_list_stream) => process_stream(game_list_stream, get_steam_game_id, twitch_game_name, steamAPIkey, res)
        ).end();
   
    }

    function get_steam_game_id(body, twitch_game_name, steamAPIkey, res){
        const gameData = JSON.parse(body);
        /*In here we will iteratre through the JSON file for the ID*/
        for(i = 0; i < gameData.response.apps.length; i++){
            if(twitch_game_name === gameData.response.apps[i].name){
                steam_appid = gameData.response.apps[i].appid;
                res.write(`<div><iframe src = "https://store.steampowered.com/widget/${steam_appid}" frameborder="0" width="646" height="190"></iframe></div>`, () => get_steam_game_news(steam_appid, steamAPIkey))
                return;
            }
        }
        
        steam_game_not_found(twitch_game_name);
        return;
    }

    function get_steam_game_news(steam_appid, steamAPIkey){
        const steam_news_endpoint = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?key=${steamAPIkey}&appid=${steam_appid}`;
        options = {
            method: "GET"
        }
        https.request(steam_news_endpoint, options, 
            (news_stream) => process_stream(news_stream, send_news_content, res)
        ).end();
    }

    function send_news_content(body, res){
        news_content = JSON.parse(body);
        if (news_content?.appnews?.newsitems[0] != null){
            my_url = news_content.appnews.newsitems[0].url;
            my_title = news_content.appnews.newsitems[0].title;
            // res.writeHead(302, {"Location": `${my_content}`});
            // res.end();
            res.end(`<div>${my_title}</div><div><a href = "${my_url}" > News Page </a></div>`);
        }
        else{
            steam_news_not_found();
            return;
        }
        
    }

    /* Can not be found errors */
    function not_found(){
        res.writeHead(404, {"Content-Type": "text/html"});
        res.end(`<h1>Please get a Streamer ID from : https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/</h1>`);
    }

    function no_recent_played(){
        res.writeHead(404, {"Content-Type": "text/html"});
        res.end(`<h1>Twitch streamer can not be found please check https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/ for valid ID</h1>`);
    }

    function steam_game_not_found(twitch_game_name){
        res.end(`<h1>${twitch_game_name} Steam Game Not Found Or Not in Steam Web API Database</h1>`);
    }

    function steam_news_not_found(){
        res.writeHead(404, {"Content-Type": "text/html"});
        res.end(`<h1>Steam Game Not Found Or Not in Steam Web API Database</h1>`);
    }

}