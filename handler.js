'use strict'

const axios = require('axios');
const imageDownloader = require('image-downloader');
const nodemailer = require('nodemailer');
const fs = require('fs-promise');
const aws = require('aws-sdk');
const moment = require('moment');
const uuid = require('uuid/v4');
const RSSParser = require('rss-parser');
const htmlParse = require('node-html-parser').parse;

const feedUrl = 'http://feed.dilbert.com/dilbert/daily_strip';
const tempPath = '/tmp';

const rssParser = new RSSParser();

const table_name = `dilbert-emails-${process.env.STAGE}`;

let endpoint;
if (process.env.STAGE === 'dev') {
    endpoint = 'https://krsra02bhi.execute-api.ap-southeast-2.amazonaws.com/dev';
} else if (process.env.STAGE === 'prod') {
    endpoint = 'https://si57mflf5m.execute-api.ap-southeast-2.amazonaws.com/prod';
}

const getHtmlPage = async (url) => {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (err) {
        console.log(error);
    }
}

const getComicLink = (html) => {
    const root = htmlParse(html);

    return {
        link: 'https:' + root.querySelector('.img-comic').attributes.src,
        title: root.querySelector('.comic-title-name').text
    };
}

const saveImage = async (imgLink, fname) => {
    const options = {
        url: imgLink,
        dest: `${tempPath}/${fname}.gif`
    };

    try {
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath);
        }
        await imageDownloader.image(options);
    } catch (err) {
        console.error(err);
    }
}

const dynamoDBTable = async () => {
    aws.config.update({region: 'ap-southeast-2'});

    const docClient = new aws.DynamoDB.DocumentClient();
    const params = {
        TableName: table_name
    };

    return new Promise((resolve, reject) => {
        docClient.scan(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data.Items);
            }
        });
    });
}

const sendImageEmail = async (imgFilename, title) => {
    const table = await dynamoDBTable();

    aws.config.update({region: 'us-west-2'});

    const transporter = nodemailer.createTransport({
        SES: new aws.SES({
            apiVersion: '2010-12-01'
        })
    });

    const promises = table.map(entry => {
        if (entry.confirmed !== true) {
            return;
        }
        const mailOptions = {
            from: 'Dilbert Daily <dilbert@jbhutcheon.com>',
            to: entry.address,
            replyTo: 'James.Hutcheon@team.telstra.com',
            subject: `Dilbert ${moment(imgFilename, "YYYY-MM-DD").format('DD MMM YYYY')}: ${title}`,
            html: `<p><img src="cid:imgFilename"/></p>
                <p><a href="${endpoint}/delete?deletekey=${entry['deletion-key']}">Click here to unsubscribe!</a></p>`,
            attachments: [{
                filename: imgFilename + '.gif',
                path: `${tempPath}/${imgFilename}.gif`,
                cid: 'imgFilename'
            }]
        }

        return new Promise((resolve, reject) => {
            transporter.sendMail(mailOptions, (err, info) => {
                if (err) {
                    console.error(err);
                    reject(err);
                } else {
                    console.log(info);
                    resolve();
                }
            });
        });
    });

    return Promise.all(promises);
}

const sendConfirmationEmail = async (address, confirmKey) => {
    aws.config.update({region: 'us-west-2'});

    const transporter = nodemailer.createTransport({
        SES: new aws.SES({
            apiVersion: '2010-12-01'
        })
    });

    const mailOptions = {
        from: 'Dilbert Daily <dilbert@jbhutcheon.com>',
        to: address,
        replyTo: 'James.Hutcheon@team.telstra.com',
        subject: `Welcome to Dilbert Daily`,
        html: `<p>Thank you for signing up to Dilbert Daily. To receive Dilbert every day at 8am, please click the link here: <a href="${endpoint}/confirm?confirmkey=${confirmKey}">Confirm Subscription!</a></p>`,
    }

    return new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
                console.error(err);
                reject(err);
            } else {
                console.log(info);
                resolve();
            }
        });
    });
}

const sendNotificationEmail = async (address) => {
    aws.config.update({region: 'us-west-2'});

    const transporter = nodemailer.createTransport({
        SES: new aws.SES({
            apiVersion: '2010-12-01'
        })
    });

    const mailOptions = {
        from: 'Dilbert Daily <dilbert@jbhutcheon.com>',
        to: 'James.Hutcheon@team.telstra.com',
        subject: `New signup to Dilbert Daily`,
        html: `<p>A new user has signed up to Dilbert baby! Their email address is ${address}</p>`,
    }

    return new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
                console.error(err);
                reject(err);
            } else {
                console.log(info);
                resolve();
            }
        });
    });
}

const deleteAddress = async address => {
    aws.config.update({region: 'ap-southeast-2'});

    const docClient = new aws.DynamoDB.DocumentClient();
    const params = {
        TableName: table_name,
        Key: {
            address: address
        }
    };

    return new Promise((resolve, reject) => {
        console.log(`Attempting to delete ${address}`);
        docClient.delete(params, (err, data) => {
            if (err) {
                console.error(`Couldn't delete! Error: ${err}`);
                reject();
            } else {
                console.log(`Deleted!`)
                resolve();
            }
        })

    });
}

const confirmAddress = async address => {
    aws.config.update({region: 'ap-southeast-2'});

    const docClient = new aws.DynamoDB.DocumentClient();
    const params = {
        TableName: table_name,
        Key: {
            address: address
        },
        AttributeUpdates: {
            confirmed: {
                Action: 'PUT',
                Value: true
            }
        }
    };

    return new Promise((resolve, reject) => {
        console.log(`Attempting to confirm ${address}`);
        docClient.update(params, (err, data) => {
            if (err) {
                console.error(`Couldn't confirm! Error: ${err}`);
                reject();
            } else {
                console.log(`Confirmed!`)
                resolve();
            }
        })

    });
}

module.exports.getDilbert = async (event, context) => {
    const feed = await rssParser.parseURL(feedUrl);
    const item = feed.items[0]; // most recent is at top of list

    const html = await getHtmlPage(item.link);
    const { link, title } = getComicLink(html);
    await saveImage(link, item.id);
    await sendImageEmail(item.id, title);

    console.log('Sent daily dilbert!');
};

module.exports.removeEmail = async (event, context) => {
    console.log(event.queryStringParameters.deletekey);
    const delete_key = event.queryStringParameters.deletekey;

    aws.config.update({region: 'ap-southeast-2'});

    const table = await dynamoDBTable();

    let address_to_delete;
    table.map(item => {
        if (item['deletion-key'] === delete_key) {
            address_to_delete = item.address;
        }
    });

    if (!address_to_delete) {
        console.log("Didn't find address to delete");
        return {
            statusCode: 400,
            headers: {
                'Content-Type': 'text/html'
            },
            body: `<html><head><title>Dilbert Daily</title></head><body><p>Whoops! Something went wrong. Please contact me and let me know!</p></body></html>`
        }
    } else {
        console.log(`Deleted ${address_to_delete}`);

        try {
            await deleteAddress(address_to_delete);
        } catch (err) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'text/html'
                },
                body: `<html><head><title>Dilbert Daily</title></head><body><p>Whoops! Something went wrong. Please contact me and let me know!</p></body></html>`
            }
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/html'
            },
            body: `<html><head><title>Dilbert Daily</title></head><body><p>Unsuccessfully subscribed ${address_to_delete} from Dilbert Daily. Sorry to see you go!</p></body></html>`
        };
    }
}

module.exports.addEmail = async (event, context) => {
    console.log(event);
    const body = JSON.parse(event.body);
    const emailAddress = body.email;
    const docClient = new aws.DynamoDB.DocumentClient();

    aws.config.update({region: 'ap-southeast-2'});

    const deleteKey = uuid();

    console.log(emailAddress);

    const getParams = {
        TableName: table_name,
        Key: {
            'address': emailAddress
        }
    }

    const fail400 = (message) => {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': true,
            },
            body: JSON.stringify({
                success: false,
                message: message
            })
        };
    }

    const succeed200 = (message) => {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': true,
            },
            body: JSON.stringify({
                success: true,
                message: message
            })
        }
    }

    try {
        const result = await new Promise((resolve, reject) => {
            docClient.get(getParams, (err, response) => {
                if (err) {
                    const response = fail400(`Unable to add ${emailAddress}. Please try again later. ${err}}`)
                    console.log(`Failed to GET: ${JSON.stringify(response)}`);
                    reject(response);
                } else {
                    if (!response.Item) {
                        const putParams = {
                            TableName: table_name,
                            Item: {
                                'address': emailAddress,
                                'deletion-key': deleteKey,
                                'confirmed': false
                            }
                        };
        
                        docClient.put(putParams, (err, response) => {
                            if (err) {
                                const response = fail400(`Unable to add ${emailAddress}. Please try again later. ${err}`);
                                console.log(`Failed to PUT: ${JSON.stringify(response)}`);
                                reject(response);
                            } else {
                                const response = succeed200(`Successfully added ${emailAddress}`);
                                console.log(`Succeeded: ${JSON.stringify(response)}`);
                                resolve(response);
                            }
                        });
                    } else {
                        const response = fail400(`That email address is already subscribed! Whoops!`);
                        console.log(`Email already exists: ${JSON.stringify(response)}`);
                        reject(response);
                    }
                }
            });
        });

        console.log(`Result: ${JSON.stringify(result)}`);
        await sendConfirmationEmail(emailAddress, deleteKey);
        return result;
    } catch (err) {
        console.log(`Error: ${JSON.stringify(err)}`);
        return err;
    }
}

module.exports.confirmEmail = async (event, context) => {
    console.log(event.queryStringParameters.confirmkey);
    const confirm_key = event.queryStringParameters.confirmkey;

    aws.config.update({region: 'ap-southeast-2'});

    const table = await dynamoDBTable();

    let address_to_confirm;
    table.map(item => {
        if (item['deletion-key'] === confirm_key) {
            address_to_confirm = item.address;
        }
    });

    if (!address_to_confirm) {
        console.log("Didn't find address to confirm");
        return {
            statusCode: 400,
            headers: {
                'Content-Type': 'text/html'
            },
            body: `<html><head><title>Dilbert Daily</title></head><body><p>Whoops! Something went wrong. Please contact me and let me know!</p></body></html>`
        }
    } else {
        console.log(`Confirmed ${address_to_confirm}`);

        try {
            await confirmAddress(address_to_confirm);
            await sendNotificationEmail(address_to_confirm);
        } catch (err) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'text/html'
                },
                body: `<html><head><title>Dilbert Daily</title></head><body><p>Whoops! Something went wrong. Please contact me and let me know!</p></body></html>`
            }
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/html'
            },
            body: `<html><head><title>Dilbert Daily</title></head><body><p>Successfully confirmed ${address_to_confirm}. You are subscribed to Dilbert Daily!</p></body></html>`
        };
    }
}