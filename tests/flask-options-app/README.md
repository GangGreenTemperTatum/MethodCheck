### Flask Options App

This is a simple Flask application that demonstrates how to handle HTTP OPTIONS requests.
It is designed to be run inside a Docker container and can be used for testing purposes.
The app is configured to run on port 5000 inside the container and can be accessed on port 8081 on your localhost.

- [Flask Options App](#flask-options-app)
- [Testing the App](#testing-the-app)
- [Accessing the App](#accessing-the-app)
- [Stopping the App](#stopping-the-app)
- [Testing HTTP OPTIONS Requests](#testing-http-options-requests)

### Testing the App

Navigate to the flask-options-app directory and execute the following commands:

```bash
docker build -t flask-options-app .
docker run --rm -it -p 8081:5000 flask-options-app

# If you want to run a shell inside the container for debugging:
docker run -it -p 8081:5000 --entrypoint /bin/sh flask-options-app

# If you want to run the app in the background:
docker run -d -p 8081:5000 flask-options-app
```

This will build the Docker image and run the container, mapping port 5000 inside the container to port 8081 on your localhost.

### Accessing the App

Once the container is running, you can access the Flask app by navigating to [`http://localhost:8081/api/test`](http://localhost:8081/api/test) in your web browser.
You should see the Flask app running and be able to interact with it.

### Stopping the App

To stop the app, you can either stop the container from your terminal or use `docker-compose down` if you are using Docker Compose.

### Testing HTTP OPTIONS Requests

You can test the app by sending a GET request to the `/api/test` endpoint. You can use tools like `curl`, Postman, or your web browser to do this.

```bash
curl -X GET http://localhost:8081/api/test \
  -x http://127.0.0.1:9090 \
  -k -v
```

```bash
curl -X OPTIONS http://localhost:8081/api/test \
  -x http://127.0.0.1:9090 \
  -k -v
```

To find the traffic in Caido, you can use the following HTTQL query :

```sql
request.url == "http://localhost:8081/api/test"
```

Or:

```sql
request.url == "http://localhost:8081/api/test" and request.method == "OPTIONS"
```

Or:

```sql
request.url.path == "/api/test"
```