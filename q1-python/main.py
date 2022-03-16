import time


#Limit to the amount of records in the cache. Size of the limit is irrelevant as the algorithm to find the record is O(1)
N = 5
#a tupple of a list and a dictionary: #1 is index->isbn, #2 is isbn->Book
#That way we can track the order in which the elements have entered the cache, and keep the O(1) access time
cachedBooks = (list(), dict())

#original "get the record" function
def get_book_info(isbn):
    print("Retrieveing records...")
    #imitation of a server-request delay
    time.sleep(1)
    #in real-life situation it would be a request to the server to provide data
    return bookList.get(isbn)

#Wrapper function that optimizes the requests from the database by implementing a cache storage
def get_book_info_optimized(isbn):
    if isbn not in cachedBooks[1]:
        if len(cachedBooks[0]) == N:
            removeISBN = cachedBooks[0].pop(0)
            cachedBooks[1].pop(removeISBN)
        cachedBooks[0].append(isbn)
        cachedBooks[1][isbn] = get_book_info(isbn)
    return cachedBooks[1].get(isbn)

    

# mock "database" for testing purposes only. The actual data (as in, an Object with book information or just the titles) does not matter, 
# they would be stored in a dictionary equally well
bookList = dict()
bookList["1"] = { "title": "War and Peace", "author" : "Leo Tolstoy", "language" : "Russian"}
bookList["2"] = { "title": "Dune", "author" : "Frank Herbert", "language" : "English"}
bookList["3"] = { "title": "Count of Monte Cristo", "author" : "Alexandre Dumas", "language" : "French"}
bookList["4"] = { "title": "Sapiens: A Brief History of Humankind", "author" : "Yuval Noah Harari", "language" : "Hebrew"}
bookList["5"] = { "title": "Kobzar", "author" : "Taras Shevchenko", "language" : "Ukrainian"}
bookList["6"] = { "title": "Amphibian Man", "author" : "Alexander Belyaev", "language" : "Russian"}

