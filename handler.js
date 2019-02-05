'use strict'

const axios = require('axios');
const imageDownloader = require('image-downloader');
const nodemailer = require('nodemailer');
const fs = require('fs-promise');
const aws = require('aws-sdk');
const moment = require('moment');
const RSSParser = require('rss-parser');
const htmlParse = require('node-html-parser').parse;

const feedUrl = 'http://feed.dilbert.com/dilbert/daily_strip';
const tempPath = '/tmp';

const rssParser = new RSSParser();

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

const getEmailList = async () => {
    aws.config.update({region: 'ap-southeast-2'});

    const docClient = new aws.DynamoDB.DocumentClient();
    const params = {
        TableName: 'dilbert-emails'
    };

    return new Promise((resolve, reject) => {
        docClient.scan(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                const { Items } = data;
                const addresses = Items.map(obj => {
                    return obj.address;
                })
                resolve(addresses);
            }
        });
    });
}

const sendImageEmail = async (imgFilename, title) => {
    const emails = await getEmailList();

    aws.config.update({region: 'us-west-2'});

    const transporter = nodemailer.createTransport({
        SES: new aws.SES({
            apiVersion: '2010-12-01'
        })
    });

    const mailOptions = {
        from: 'Dilbert Daily <dilbert@jbhutcheon.com>',
        bcc: emails,
        reply_to: 'James.Hutcheon@team.telstra.com',
        subject: `Dilbert ${moment(imgFilename, "YYYY-MM-DD").format('DD MMM YYYY')}: ${title}`,
        html: '<img src="cid:imgFilename"/>',
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