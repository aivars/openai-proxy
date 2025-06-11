# OpenAI Proxy Server for SwiftUI AI Wrapper

This is a secure, cost-effective proxy server built for deployment on Vercel.

## Features
- ✅ Free hosting on Vercel
- ✅ Automatic HTTPS
- ✅ Secure hash-based authentication
- ✅ Rate limiting and DDoS protection
- ✅ Serverless (pay only for usage)
- ✅ Support for text and image messages

## Quick Setup

### 1. Deploy to Vercel
1. Fork this repository or create a new one with these files
2. Go to [vercel.com](https://vercel.com) and sign up
3. Connect your GitHub repository
4. Add environment variables:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `SHARED_SECRET`: A secure secret key (generate a random string)

### 2. Get Your Proxy URL
After deployment, you'll get a URL like: `https://your-project.vercel.app/api/proxy`

### 3. Update Your iOS App
Update the `location` variable in `ChatModel.swift` with your new URL.

## Environment Variables

Set these in your Vercel dashboard:

- `OPENAI_API_KEY`: Get from [OpenAI API Keys](https://platform.openai.com/api-keys)
- `SHARED_SECRET`: Generate a secure random string (32+ characters)

## Security Features

- Hash-based authentication prevents unauthorized access
- Environment variables keep secrets secure
- Input validation and error handling
- HTTPS by default

## Cost Estimates

- **Vercel**: Free tier covers most personal usage
- **OpenAI**: ~$0.001-0.01 per message (depending on model)
- **Total**: Likely $0-5/month for personal use

## Troubleshooting

Check Vercel's function logs if you encounter issues. Common problems:
- Missing environment variables
- Incorrect hash generation
- OpenAI API key issues

## Contributing

This proxy server was built for the SwiftUI AI Wrapper project. Feel free to fork, modify, and improve it for your own projects!

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built for use with [SwiftUI AI Wrapper](https://github.com/aivars/AIWrapper)
- Inspired by the need for secure, cost-effective OpenAI API proxying
- Uses Vercel's excellent serverless platform 