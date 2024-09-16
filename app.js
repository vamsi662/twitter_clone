const express = require('express')
const app = express()
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const dbPath = path.join(__dirname, 'twitterClone.db')

app.use(express.json())

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running Successfully...')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const userQuery = `SELECT * FROM user WHERE username = '${username}'`
  const hashedPassword = await bcrypt.hash(password, 10)
  const dbUser = await db.get(userQuery)
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const createUserQuery = `INSERT INTO user (username,password,name,gender) VALUES ('${username}','${hashedPassword}','${name}','${gender}')`
      await db.run(createUserQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const userQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(userQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'mySecretCode')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'mySecretCode', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const tweetsQuery = `SELECT
                        user.username AS username, tweet.tweet AS tweet,tweet.date_time AS dateTime
                      FROM
                        follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id INNER JOIN user ON tweet.user_id = user.user_id
                      WHERE follower.follower_user_id=(SELECT user.user_id FROM user WHERE username='${username}')
                      ORDER BY dateTime DESC
                      LIMIT 4`
  const userTweets = await db.all(tweetsQuery)
  response.send(userTweets)
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username} = request
  const userFollowingQuery = `SELECT
                                name
                              FROM
                                user INNER JOIN (SELECT
                                                  follower.following_user_id as following_id
                                                FROM
                                                  user INNER JOIN follower ON user.user_id=follower.follower_user_id
                                                WHERE user.username='${username}') AS T ON user.user_id = T.following_id`
  const usersFollowing = await db.all(userFollowingQuery)
  response.send(usersFollowing)
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username} = request

  const userIdQuery = `SELECT user_id FROM user WHERE username='${username}'`
  const userIdObject = await db.get(userIdQuery)
  const userId = userIdObject.user_id

  const userFollowersQuery = `SELECT
                                user.name
                              FROM user INNER JOIN (SELECT
                                                      follower_user_id as follower_id
                                                    FROM
                                                      follower
                                                    WHERE following_user_id=${userId}) AS T ON user.user_id=T.follower_id`
  const usersFollowers = await db.all(userFollowersQuery)
  response.send(usersFollowers)
})

app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const {username} = request

  const tweetQuery = `SELECT
                        user_id AS userId,
                        tweet,
                        date_time
                      FROM
                        tweet
                      WHERE tweet.tweet_id = ${tweetId}`
  const tweetUserIdObject = await db.get(tweetQuery)
  const tweetUserId = tweetUserIdObject.userId
  const tweetText = {tweet: tweetUserIdObject.tweet}
  const tweetDate = {dateTime: tweetUserIdObject.date_time}

  const userIdQuery = `SELECT user_id FROM user WHERE username='${username}'`
  const userIdObject = await db.get(userIdQuery)
  const userId = userIdObject.user_id

  const isUserFollowingTweetUserQuery = `SELECT
                                          *
                                        FROM
                                          follower
                                        WHERE following_user_id=${tweetUserId} and follower_user_id=${userId}`
  const isUserFollowingTweetUser = await db.get(isUserFollowingTweetUserQuery)

  if (isUserFollowingTweetUser !== undefined) {
    const repliesQuery = `  SELECT COUNT(reply_id) AS replies
                            FROM reply
                            WHERE tweet_id=${tweetId}`
    const repliesObject = await db.get(repliesQuery)

    const likesQuery = `SELECT COUNT(like_id) AS likes
                          FROM like
                          WHERE tweet_id=${tweetId}`
    const likesObject = await db.get(likesQuery)

    response.send({
      ...tweetText,
      ...likesObject,
      ...repliesObject,
      ...tweetDate,
    })
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request

    const tweetQuery = `SELECT
                        user_id AS userId
                      FROM
                        tweet
                      WHERE tweet_id = ${tweetId}`
    const tweetUserIdObject = await db.get(tweetQuery)
    const userIdOftweetId = tweetUserIdObject.userId

    const userIdQuery = `SELECT user_id FROM user WHERE username='${username}'`
    const userIdObject = await db.get(userIdQuery)
    const userId = userIdObject.user_id

    const isUserFollowingTweetUserQuery = `SELECT
                                          *
                                        FROM
                                          follower
                                        WHERE following_user_id=${userIdOftweetId} and follower_user_id=${userId}`
    const isUserFollowingTweetUser = await db.get(isUserFollowingTweetUserQuery)

    if (isUserFollowingTweetUser !== undefined) {
      const likesQuery = `SELECT user.username as username
                          FROM like INNER JOIN user ON like.user_id=user.user_id
                          WHERE tweet_id=${tweetId}`
      const likesOfUsersArray = await db.all(likesQuery)
      const likes = likesOfUsersArray.map(eachItem => eachItem.username)

      response.send({likes: likes})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request

    const tweetQuery = `SELECT
                        user_id AS userId
                      FROM
                        tweet
                      WHERE tweet.tweet_id = ${tweetId}`
    const tweetUserIdObject = await db.get(tweetQuery)
    const userIdOftweetId = tweetUserIdObject.userId

    const userIdQuery = `SELECT user_id FROM user WHERE username='${username}'`
    const userIdObject = await db.get(userIdQuery)
    const userId = userIdObject.user_id

    const isUserFollowingTweetUserQuery = `SELECT
                                          *
                                        FROM
                                          follower
                                        WHERE following_user_id=${userIdOftweetId} and follower_user_id=${userId}`
    const isUserFollowingTweetUser = await db.get(isUserFollowingTweetUserQuery)

    if (isUserFollowingTweetUser !== undefined) {
      const replyQuery = `SELECT user.name AS name,reply.reply AS reply
                          FROM reply INNER JOIN user ON reply.user_id=user.user_id
                          WHERE tweet_id=${tweetId}`
      const replies = await db.all(replyQuery)
      response.send({replies})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request

  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}'`
  const getUserIdObject = await db.get(getUserIdQuery)
  const userId = getUserIdObject.user_id

  // const tweetQuery = `SELECT
  //                       tweet.tweet AS tweet,
  //                       COUNT(like.like_id) AS likes,
  //                       COUNT(reply.reply_id) AS replies,
  //                       tweet.date_time AS dateTime
  //                     FROM
  //                       tweet
  //                       LEFT JOIN like ON tweet.tweet_id = like.tweet_id
  //                       LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
  //                     WHERE tweet.user_id = ${userId}
  //                     GROUP BY tweet.tweet_id`
  const tweetQuery = `SELECT
	                    	tweet,
	                    	(
	                    		SELECT COUNT(like_id)
	                    		FROM like
	                    		WHERE tweet_id = tweet.tweet_id
	                    	) AS likes,
	                    	(
	                    		SELECT COUNT(reply_id)
	                    		FROM reply
	                    		WHERE tweet_id = tweet.tweet_id
	                    	) AS replies,
	                    	date_time AS dateTime
	                    FROM tweet
	                    WHERE user_id = ${userId}`

  const userTweets = await db.all(tweetQuery)
  response.send(userTweets)
})

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  // const {tweet} = request.body
  const {username, tweet} = request
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`
  const getUserIdObject = await db.get(getUserIdQuery)
  const userId = getUserIdObject.user_id
  //const date = format(new Date(), 'yyyy-MM-dd h:m:s')
  const addtweetQuery = `INSERT INTO
                            tweet (user_id,tweet,date_time)
                          VALUES (${userId},'${tweet}','${new Date()}')`
  await db.run(addtweetQuery)
  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request

    const userIdQuery = `SELECT user_id FROM user WHERE username='${username}'`
    const userIdObject = await db.get(userIdQuery)
    const userId = userIdObject.user_id

    const tweetIdOfUserQuery = `SELECT
                                *
                              FROM
                                tweet
                              WHERE user_id = ${userId} AND tweet_id=${tweetId}`
    const tweetIdOfUserObject = await db.get(tweetIdOfUserQuery)

    if (tweetIdOfUserObject !== undefined) {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId}`
      await db.run(deleteTweetQuery)
      response.send('Tweet Removed')
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)
module.exports = app
