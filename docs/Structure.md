# ked DB

ked is based around LDAP.

## Structure

A document (kedDocument) is composed of any number of entry (kedEntry). An entry is a unit of a single type. An image in a document would be an entry. An entry have history represented by an other related entry with its attribute kedNext set to the current entry.

-+-[kedDocument](1)-+
 |                  +-[kedEntry](1)<kedNext:1>
 |                  +-[kedEntry](1)
 |                  +-[kedEntry](2)
 |                  +-[kedEntry](3)<kedNext:3>
 |                  +-[kedEntry](3)
 |                  +-...
 +-[kedDocument](2)-+
 |                  +-[kedEntry](1)
 |                  +-...
 +-...

Updated version keep the same id. From the ldap point of view, the rdn is build with kedId=<id>+kedTimestamp=<time>

## Task

Any kedDocument can be turned into a task by adding the object class kedTask. A task can have more attributes. A task might be processed differently by the application.

An entry is not supposed to be turned into a task. But there is no objective reason to not do it. Except, maybe, that it makes no sense to have, for example, a picture set as a task (maybe if you write a texte, turn it into a picture and then it may start to have a sense ... but it makes no sense to do that). So, from the backend point of view, there is no limitation to turn an entry into a task.

## Event

Any kedDocument can be turned into an event by adding the object class kedDocument. Nothing is clearly defined or implemented yet, just something that would be done.

### Presentation

No mechanism related to presentation is available. It's up to the application to set values as needed to have a reproducible reprensentation.

## Creating an update

Updating an entry happend in two writes :

  * Create the new entry
  * Modify the previous entry to have it kedNext pointing the new one

This operation might need some locking mechanism.

## Creating a document

Creating a new document consist of creating an kedDocument and then adding some kedEntry. The document is identified, by the user, by its name. There's no limit (at least only ldap implementation limits) on how many number of name a document can have.

## Fetching a document

A document is found by its name and then all kedEntry having no kedNext attribute are fetched to build the document.

If an implementation store only delta between version, it has to recompose the end document from deltas.

## Deleting a document

A document is deleted by having its attribute kedDelete set to the current time. A deleted document can be recovered and an external mechanism of purging database from old deleted document can be set.

## Creation and modification time

If creation time is set by kedTimestamp, modification can be tricky. With features like "auto-save", one modification can happen through several modification over time. Having each "auto-save" iteration as an historic version of the document might not be wanted. Thus kedModified is there to offer that kind of support.
It can also be used to have a control over simultaneous modification of the content. 

# Tags

Tag is a well known system. You tag something and search by tags. Here we just add the ability to tag a tag. So if you create a tag "Project" which you want to use to tag all document about any projects, but you also want to create a tag for each project with the project name. By tagging the tag "project name" with the tag "Project" you achieve this structure.

## ACL

ACL are enforced through tag, people have access to item based on their tag.