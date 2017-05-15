/**
 * This file contains all of the web and hybrid functions for interacting with
 * Bot and the Watson Conversation service. When API calls are not needed, the
 * functions also do basic messaging between the client and the server.
 *
 * @summary   Functions for Chat Bot.
 *
 * @link      cloudco.mybluemix.net
 * @since     0.0.3
 * @requires  app.js
 *
 */
 var watson = require('watson-developer-cloud');
 var cfenv = require('cfenv');
 var chrono = require('chrono-node');
 var fs = require('fs');
 // load local VCAP configuration
 var vcapLocal = null;
 var appEnv = null;
 var appEnvOpts = {};
 var conversationWorkspace, conversation;

 // get the app environment from Cloud Foundry, defaulting to local VCAP
 function initializeAppEnv() {
     appEnv = cfenv.getAppEnv(appEnvOpts);
     if (appEnv.isLocal) {
         require('dotenv').load();
     }
     if (appEnv.services.cloudantNoSQLDB) {
         initCloudant();
     }
     else {
         console.error("No Cloudant service exists.");
     }
     if (appEnv.services.conversation) {
         initConversation();
     }
     else {
         console.error("No Watson conversation service exists");
     }
 }


 // =====================================
 // CREATE THE SERVICE WRAPPER ==========
 // =====================================
 // Create the service wrapper
 function initConversation() {
     var conversationCredentials = appEnv.getServiceCreds("conversation");
     console.log(conversationCredentials);
     var conversationUsername = process.env.CONVERSATION_USERNAME || conversationCredentials.username;
     var conversationPassword = process.env.CONVERSATION_PASSWORD || conversationCredentials.password;
     var conversationURL = process.env.CONVERSATION_URL || conversationCredentials.url;
     conversation = watson.conversation({
         url: conversationURL
         , username: conversationUsername
         , password: conversationPassword
         , version_date: '2016-07-11'
         , version: 'v1'
     });
     // check if the workspace ID is specified in the environment
     conversationWorkspace = process.env.CONVERSATION_WORKSPACE;
     // if not, look it up by name or create one
     if (!conversationWorkspace) {
         const workspaceName = 'bot-100-anos';
         console.log('No conversation workspace configured in the environment.');
         console.log(`Looking for a workspace named '${workspaceName}'...`);
         conversation.listWorkspaces((err, result) => {
             if (err) {
                 console.log('Failed to query workspaces. Conversation will not work.', err);
             }
             else {
                 const workspace = result.workspaces.find(workspace => workspace.name === workspaceName);
                 if (workspace) {
                     conversationWorkspace = workspace.workspace_id;
                     console.log("Using Watson Conversation with username", conversationUsername, "and workspace", conversationWorkspace);
                 }
                 else {
                     console.log('Error finding workspace_id');
                 }
             }
         });
     }
     else {
         console.log('Workspace ID was specified as an environment variable.');
         console.log("Using Watson Conversation with username", conversationUsername, "and workspace", conversationWorkspace);
     }
 }
 // =====================================
 // REQUEST FOR BOT =====================
 // =====================================
 // Allow clients to interact with Bot

var chatbot = {
    sendMessage: function (req, callback) {
//        var owner = req.user.username;
        buildContextObject(req, function (err, params) {
                if (err) {
                    console.log("Error in building the parameters object: ", err);
                    return callback(err);
                }
                if (params.message) {
                    var conv = req.body.context.conversation_id;
                    var context = req.body.context;
                    var res = {
                        intents: []
                        , entities: []
                        , input: req.body.text
                        , output: {
                            text: params.message
                        }
                        , context: context
                    };
                    //                chatLogs(owner, conv, res, () => {
                    //                    return
                    callback(null, res);
                    //                });
                }
                else if (params) {
                    // Send message to the conversation service with the current context
                    conversation.message(params, function (err, data) {
                            if (err) {
                                console.log("Error in sending message: ", err);
                                return callback(err);
                            }else{

                            var conv = data.context.conversation_id;
                            console.log("Got response from Bot: ", JSON.stringify(data));
//                            if (data.context.system.dialog_turn_counter > 1) {
//                                chatLogs(owner, conv, data, () => {
//                                    return callback(null, data);
//                                });
//                            }
//                            else {
                                return callback(null, data);
//                            }
                        }
                    });
            }
        });
}
};
// ===============================================
// LOG MANAGEMENT FOR USER INPUT FOR ANA =========
// ===============================================
function chatLogs(owner, conversation, response, callback) {
    console.log("Response object is: ", response);
    // Blank log file to parse down the response object
    var logFile = {
        inputText: ''
        , responseText: ''
        , entities: {}
        , intents: {}
    , };
    logFile.inputText = response.input.text;
    logFile.responseText = response.output.text;
    logFile.entities = response.entities;
    logFile.intents = response.intents;
    logFile.date = new Date();
    var date = new Date();
    var doc = {};
    Logs.find({
        selector: {
            'conversation': conversation
        }
    }, function (err, result) {
        if (err) {
            console.log("Couldn't find logs.");
            callback(null);
        }
        else {
            doc = result.docs[0];
            if (result.docs.length === 0) {
                console.log("No log. Creating new one.");
                doc = {
                    owner: owner
                    , date: date
                    , conversation: conversation
                    , lastContext: response.context
                    , logs: []
                };
                doc.logs.push(logFile);
                Logs.insert(doc, function (err, body) {
                    if (err) {
                        console.log("There was an error creating the log: ", err);
                    }
                    else {
                        console.log("Log successfull created: ", body);
                    }
                    callback(null);
                });
            }
            else {
                doc.lastContext = response.context;
                doc.logs.push(logFile);
                Logs.insert(doc, function (err, body) {
                    if (err) {
                        console.log("There was an error updating the log: ", err);
                    }
                    else {
                        console.log("Log successfull updated: ", body);
                    }
                    callback(null);
                });
            }
        }
    });
}
// ===============================================
// UTILITY FUNCTIONS FOR CHATBOT AND LOGS ========
// ===============================================
/**
 * @summary Form the parameter object to be sent to the service
 *
 * Update the context object based on the user state in the conversation and
 * the existence of variables.
 *
 * @function buildContextObject
 * @param {Object} req - Req by user sent in POST with session and user message
 */
function buildContextObject(req, callback) {
    var message = req.body.text;
//    var userTime = req.body.user_time;
    var context;
    if (!message) {
        message = '';
    }
    // Null out the parameter object to start building
    var params = {
        workspace_id: conversationWorkspace
        , input: {}
        , context: {}
    };


    if (req.body.context) {
        context = req.body.context;
        params.context = context;
    }
    else {
        context = '';
    }
    // Set parameters for payload to Watson Conversation
    params.input = {
        text: message // User defined text to be sent to service
    };
    // This is the first message, add the user's name and get their healthcare object
//    if ((!message || message === '') && !context) {
//        params.context = {
//            fname: req.user.fname
//            , lname: req.user.lname
//        };
//    }
    return callback(null, params);
}
module.exports = chatbot;
