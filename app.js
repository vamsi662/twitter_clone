const express = require('express')
const app = express()
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const {format} = require('date-fns')

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
    response.send('Invalid User')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'qwerty')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid Password')
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
    jwt.verify(jwtToken, 'qwerty', async (error, payload) => {
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
                        user NATURAL JOIN tweet
                      WHERE user.username = '${username}'
                      ORDER BY tweet.dateTime DESC
                      LIMIT 4`
  const userTweets = await db.all(tweetsQuery)
  response.send(userTweets)
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const userFollowingQuery = `SELECT
                                DISTINCT user.username as name
                              FROM
                                user INNER JOIN follower ON user.user_id=follower.following_user_id`
  const usersFollowing = await db.all(userFollowingQuery)
  response.send(usersFollowing)
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const userFollowersQuery = `SELECT
                                DISTINCT user.username as name
                              FROM user INNER JOIN follower ON user.user_id=follower.follower_user_id`
  const usersFollowers = await db.all(userFollowersQuery)
  response.send(usersFollowers)
})

app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const {username} = request

  const userFollowingQuery = `SELECT
                  follower.following_user_id as followingUserId
                FROM
                  user INNER JOIN follower ON user.user_id=follower.follower_user_id
                WHERE user.username = '${username}'`
  const userFollowingArray = await db.all(userFollowingQuery)
  const userFollowing = userFollowingArray.map(
    eachItem => eachItem.followingUserId,
  )

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

  if (userFollowing.includes(tweetUserId)) {
    const responseQuery = `SELECT
                            COUNT(like.like_id) AS likes,
                            COUNT(reply.reply_id) AS replies
                          FROM reply INNER JOIN like ON reply.tweet_id = like.tweet_id
                          GROUP BY reply.tweet_id
                          HAVING reply.tweet_id = ${tweetId}`
    const responseObject = await db.get(responseQuery)
    const tweetDetails = tweetText + responseObject + tweetDate
    response.send(tweetDetails)
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

    const userFollowingQuery = `SELECT
                  follower.following_user_id as followingUserId
                FROM
                  user INNER JOIN follower ON user.user_id=follower.follower_user_id
                WHERE user.username = '${username}'`
    const userFollowingArray = await db.all(userFollowingQuery)
    const userFollowing = userFollowingArray.map(
      eachItem => eachItem.followingUserId,
    )

    const tweetQuery = `SELECT
                  user_id AS userId,
                  tweet,
                  date_time
                FROM
                  tweet
                WHERE tweet.tweet_id = ${tweetId}`
    const tweetUserIdObject = await db.get(tweetQuery)
    const tweetUserId = tweetUserIdObject.userId

    if (userFollowing.includes(tweetUserId)) {
      const likeUsernamesQuery = `SELECT
                          user.username as username
                        FROM 
                          user NATURAL JOIN like
                        WHERE like.tweet_id = ${tweetId}`
      const likesUsernamesArray = await db.all(likeUsernamesQuery)
      const tweetLikeUsernames = likesUsernamesArray.map(
        eachItem => eachItem.username,
      )
      const usernamesLikeTweet = {likes: tweetLikeUsernames}
      response.send(usernamesLikeTweet)
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

    const userFollowingQuery = `SELECT
                  follower.following_user_id as followingUserId
                FROM
                  user INNER JOIN follower ON user.user_id=follower.follower_user_id
                WHERE user.username = '${username}'`
    const userFollowingArray = await db.all(userFollowingQuery)
    const userFollowing = userFollowingArray.map(
      eachItem => eachItem.followingUserId,
    )

    const tweetQuery = `SELECT
                          user_id AS userId
                        FROM
                          tweet
                        WHERE tweet.tweet_id = ${tweetId}`
    const tweetUserIdObject = await db.get(tweetQuery)
    const tweetUserId = tweetUserIdObject.userId

    if (userFollowing.includes(tweetUserId)) {
      const replyUsernamesQuery = `SELECT
                          user.username AS name,
                          reply.reply AS reply
                        FROM 
                          user NATURAL JOIN reply
                        WHERE reply.tweet_id = ${tweetId}`
      const replyUsernamesArray = await db.all(replyUsernamesQuery)
      const usernamesLikeTweet = {replies: replyUsernamesArray}
      response.send(usernamesLikeTweet)
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`
  const getUserIdObject = await db.get(getUserIdQuery)
  const userId = getUserIdObject.user_id

  const tweetQuery = `SELECT
                        tweet.tweet AS tweet,
                        COUNT(like_id) AS likes,
                        COUNT(reply_id) AS replies,
                        tweet.date_time AS dateTime
                      FROM
                        (tweet INNER JOIN reply ON tweet.tweet_id=reply.tweet_id) AS T INNER JOIN like ON T.tweet_id = like.tweet_id
                      WHERE tweet.user_id = ${userId}
                      GROUP BY tweet.tweet_id`
  const userTweets = await db.all(tweetQuery)
  response.send(userTweets)
})

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const {username} = request
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`
  const getUserIdObject = await db.get(getUserIdQuery)
  const userId = getUserIdObject.user_id
  const date = format(new Date(), 'yyyy-MM-d h:m:s')
  const addtweetQuery = `INSERT INTO
                            tweet (tweet,user_id,date_time)
                          VALUES ('${tweet}',${userId},${date})`
  await db.run(addtweetQuery)
  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request
    const tweetIdOfUserQuery = `SELECT
                                tweet.tweet_id AS tweet_id
                              FROM
                                user NATURAL JOIN tweet
                              WHERE user.username = '${username}'`
    const tweetIdOfUserObject = await db.all(tweetIdOfUserQuery)
    const tweetIdOfUser = tweetIdOfUserObject.map(eachItem => eachItem.tweet_id)
    if (tweetIdOfUser.includes(tweetId)) {
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
