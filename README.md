# Scrollsurf

Scrollsurf lets you scroll through wikipedia article abstracts, like/dislike them, and visit the full articles on wikipedia itself. The articles that it shows you are randomly selected from these datasets:

- [The 50000 most vital articles](https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/Level_5)

- [The Unusual articles page](https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles)

- [Wikipedia Good articles](https://en.wikipedia.org/wiki/Wikipedia:Good_articles)

- [Wikipedia Featured articles](https://en.wikipedia.org/wiki/Wikipedia:Featured_articles)

- [Wikipedia Featured pictures](https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures)


## Getting Started

```bash
npm install
```

Before you run the app for the first time, you have to download the datasets that you want using the provided package scripts.
The downloads take a long time, but one dataset is enough to run the app:

```bash
npm run download-vital-50000
npm run download-unusual
npm run download-good-articles
npm run download-featured-articles
npm run download-featured-pictures
```

Then, you can categorize the articles by running

```bash
npm run categorize
```

Currently, that's not very useful - it just builds a huge category tree that you can look at.
After downloading at least one dataset, you can

```bash
npm run dev
```

and go to [http://localhost:3000](http://localhost:3000)

Check out the [Diary](./DIARY.md)!

Next, I want to think about a way to make article selection less random by using your liked/disliked articles in some way.

## Future inspiration for more datasets / categorization

These [Main topic classifications](https://en.wikipedia.org/wiki/Category:Main_topic_classifications) are not what I have

[Wikipedia:Contents](https://en.wikipedia.org/wiki/Wikipedia:Contents)

[why not reddit](https://www.reddit.com/r/wikipedia/comments/11nnbzx/i_maintain_a_list_of_500_of_my_favourite/)

[Wikipedia:Categorization](https://en.wikipedia.org/wiki/Wikipedia:Categorization)
