const fs = require('fs');
const csv = require('csv-parser');
const uuid = require('uuid/v4');
const aws = require('aws-sdk');
aws.config.update({region: 'ap-southeast-2'});

const docClient = new aws.DynamoDB.DocumentClient();

const readCsvAndInjectToDynamoDB = filename => {
    fs.createReadStream(filename)
        .pipe(csv())
        .on('data', data => {
            const deletekey = uuid();
            const getParams = {
                TableName: 'dilbert-emails-prod',
                Key: {
                    'address': data.Address
                }
            }

            docClient.get(getParams, (err, response) => {
                if (err) {
                    console.log(err);
                } else {
                    if (!response.Item) {
                        const putParams = {
                            TableName: 'dilbert-emails-prod',
                            Item: {
                                'address': data.Address,
                                'deletion-key': deletekey,
                                'confirmed': true
                            }
                        };
    
                        docClient.put(putParams, (err, response) => {
                            if (err) {
                                console.error(err);
                            } else {
                                console.log(`Successfully added ${data.Address}`)
                            }
                        });
                    } else {
                        console.log(`${data.Address} already in database`)
                    }
                }
            });
        })
        .on('error', err => {
            console.error(data);
        })
};

readCsvAndInjectToDynamoDB('./dilbert-emails.csv')
