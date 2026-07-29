# Guided Shopping Database API Server

Backend API server for connecting to the Eyefinity SQL Server database and querying guided shopping tables.

## Setup

1. **Install Dependencies**
   ```bash
   cd server
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your database password:
   ```
   DB_PASSWORD=your_actual_password
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   ```

   Server will run on http://localhost:3001

## API Endpoints

### Health Check
```
GET /health
```

### Database Connection Test
```
GET /api/database/test
```

### Get All Tables
```
GET /api/database/tables
```

### Get Guided Shopping Tables
```
GET /api/database/tables/guided-shopping
```

### Search Tables
```
GET /api/database/tables/search/:pattern
```

### Get Table Schema
```
GET /api/database/tables/:tableName/schema
```

### Query Table Data
```
GET /api/database/tables/:tableName/data?limit=100
```

### Execute Custom Query (Read-Only)
```
POST /api/database/query
Content-Type: application/json

{
  "query": "SELECT * FROM YourTable WHERE condition = 'value'"
}
```

## Example Usage

```bash
# Test connection
curl http://localhost:3001/api/database/test

# Get all tables
curl http://localhost:3001/api/database/tables

# Get guided shopping related tables
curl http://localhost:3001/api/database/tables/guided-shopping

# Get table schema
curl http://localhost:3001/api/database/tables/YourTableName/schema

# Query table data
curl http://localhost:3001/api/database/tables/YourTableName/data?limit=10
```

## Security Notes

- Database credentials are stored in `.env` file (not committed to git)
- Only SELECT queries are allowed via the custom query endpoint
- Input sanitization is applied to prevent SQL injection
- CORS is enabled for frontend integration

## Database Connection

**Server:** 10.158.38.146:1433
**Database:** Blink_Gold_Demo2
**Driver:** SQL Server (jTDS compatible)
